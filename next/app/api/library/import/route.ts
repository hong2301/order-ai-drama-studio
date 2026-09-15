// 文件夹批量导入: POST /api/library/import  multipart(type + files[])
// 流程: 图片→图片库; 文本(txt/md/docx)→汇总; 调豆包(extract_import 工具)提取
//       {name, identity[], prompt}(已知名称/身份剔除后整理为提示词); 写目标表
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { chat, DoubaoError, type ToolDef } from "@/lib/server/doubao";
import { dataDir, getDb, persist } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const IMG_EXT = ["jpg", "jpeg", "png", "gif", "webp"];
const TEXT_MAX = 6000; // 每个文本文件截断长度
const TOTAL_MAX = 20000; // 汇总文本总长

/** 类型 -> 资料库表名 与 标签语义 */
const TABLE: Record<string, { table: string; label: string; tip: string }> = {
  characters: { table: "characters", label: "身份", tip: "人物角色(身份通常是人设/职业/关系, 如 主角/婆婆/儿子)" },
  scenes:     { table: "scenes",     label: "类型", tip: "场景(类型通常是环境/空间/时段, 如 客厅/医院/夜晚)" },
  products:   { table: "products",   label: "品类", tip: "产品(品类通常是产品类型/形态/卖点, 如 保健品/礼盒)" },
};

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return Response.json({ detail: "解析表单失败" }, { status: 400 });
  }
  const type = String(form.get("type") || "characters");
  const cfg = TABLE[type];
  if (!cfg) return Response.json({ detail: "未知导入类型" }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return Response.json({ detail: "未收到文件" }, { status: 400 });
  if (files.length > 40) return Response.json({ detail: "单次最多导入 40 个文件" }, { status: 400 });

  const db = await getDb();

  // ---------- 1) 分类: 图片入图片库; 文本汇总 ----------
  let texts: string[] = [];
  let imgIds: number[] = [];
  const now = new Date().toISOString();
  const imgDir = path.join(dataDir(), "uploads", "images");
  fs.mkdirSync(imgDir, { recursive: true });

  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const buf = Buffer.from(await f.arrayBuffer());
    if (IMG_EXT.includes(ext)) {
      const saved = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(imgDir, saved), buf);
      db.run(
        "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
        [`/api/uploads/images/${saved}`, f.name.replace(/\.\w+$/, ""), "", now, now],
      );
      imgIds.push(Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0));
    } else {
      let text = "";
      try {
        if (ext === "docx") text = (await mammoth.extractRawText({ buffer: buf })).value || "";
        else if (["txt", "md"].includes(ext)) text = buf.toString("utf8");
      } catch { /* 跳过解析失败 */ }
      if (text.trim()) texts.push(`--- 文件: ${f.name} ---\n${text.slice(0, TEXT_MAX)}`);
    }
  }
  if (!texts.length && !imgIds.length) {
    return Response.json({ detail: "文件夹内没有可解析的文本或图片" }, { status: 400 });
  }

  // ---------- 2) 调豆包提取字段 ----------
  const result: { value: { name?: string; identity?: string[]; prompt?: string } | null } = { value: null };
  const apiKey = process.env.DOUBAO_API_KEY || "";
  if (!apiKey) return Response.json({ detail: "未配置 DOUBAO_API_KEY" }, { status: 500 });
  const modelId = process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";

  const userText = [
    `用户拖入了一个文件夹，想把它作为一条「${type === "characters" ? "人物" : type === "scenes" ? "场景" : "产品"}」导入资料库（${cfg.tip}）。`,
    "以下是文件夹内全部文本内容：",
    texts.join("\n\n").slice(0, TOTAL_MAX),
    `文件夹内图片共 ${imgIds.length} 张，将自动存入图片库。`,
    "请提取该对象的：name(名称)、identity(上面要求语义的标签数组)、prompt(提示词)。",
    "prompt 规则：把文本中已经提到的名称、身份标签等「已知信息字段」剔除去掉后，整理为一段连贯、可被 AI 用于创作的提示词；如果剔除后没剩多少，就把文本内容总结成通顺的提示词。",
    "请调用 extract_import 工具返回结果。",
  ].join("\n");

  const tool: ToolDef = {
    name: "extract_import",
    description: "从文件夹导入内容中提取资料库记录字段并返回",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "名称" },
        identity: { type: "array", items: { type: "string" }, description: "标签数组" },
        prompt: { type: "string", description: "剔除已知字段后整理的提示词" },
      },
      required: ["name", "prompt"],
    },
  };

  try {
    await chat(apiKey, modelId, [{ role: "user", content: userText }], {
      tools: [tool],
      onToolCall: async (name, args) => {
        if (name === "extract_import") { result.value = args; return JSON.stringify({ ok: true }); }
        return JSON.stringify({ ok: false, detail: `未知工具 ${name}` });
      },
    });
  } catch (e) {
    if (e instanceof DoubaoError) return Response.json({ detail: `AI 提取失败: ${e.code}` }, { status: 502 });
    return Response.json({ detail: (e as Error).message }, { status: 500 });
  }

  if (!result.value?.name?.trim()) {
    return Response.json({ detail: "AI 未能从文件夹内容中识别出名称" }, { status: 422 });
  }

  // ---------- 3) 写目标表 ----------
  const name = String(result.value.name).trim().slice(0, 80);
  const identity = Array.isArray(result.value.identity) ? result.value.identity.map((s) => String(s).trim()).filter(Boolean) : [];
  const prompt = String(result.value.prompt || "").trim() || "导入自文件夹";
  db.run(
    `INSERT INTO ${cfg.table}(name, identity, prompt, image_ids, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
    [name, JSON.stringify(identity), prompt, JSON.stringify(imgIds), now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();

  return Response.json({ ok: true, id, name, identity, prompt, images: imgIds });
}