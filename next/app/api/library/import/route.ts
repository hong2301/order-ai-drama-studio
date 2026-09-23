// 资料库导入: POST /api/library/import multipart(type + files[]? + content?)
// 模式A 文件/文件夹: files[] 逐个处理 — 图片→图片库; txt/md 读文本; docx 读文本+提取内嵌图片
// 模式B 粘贴提示词: content 大段提示词, 无文件
// 之后调豆包(extract_import 工具)提取 {name, identity[], prompt}(剔除已知字段),
// 写入目标表 characters/scenes/products
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { chat, DoubaoError, type ToolDef } from "@/lib/server/doubao";
import { dataDir, getDb, persist, getApiKey } from "@/lib/server/db";
import { readImageSize } from "@/lib/server/video";
import type { Database } from "sql.js";

export const dynamic = "force-dynamic";

const IMG_EXT = ["jpg", "jpeg", "png", "gif", "webp"];
const TEXT_MAX = 6000;   // 单个文本截断
const TOTAL_MAX = 20000; // 汇总总长

const TABLE: Record<string, { table: string; typeName: string; tip: string }> = {
  characters: { table: "characters", typeName: "人物", tip: "人物身份通常是角色/职业/关系, 如 主角/儿子/护士" },
  scenes:     { table: "scenes",     typeName: "场景", tip: "场景类型通常是环境/空间/时段, 如 客厅/教室/夜晚" },
  products:   { table: "products",   typeName: "产品", tip: "产品品类通常是类型/形态/卖点, 如 保健品/礼盒" },
};

/** 插入一张图片到 images 表, 返回 id */
async function saveImage(db: Database, buf: Buffer, name: string, desc: string, now: string): Promise<number> {
  const imgDir = path.join(dataDir(), "uploads", "images");
  fs.mkdirSync(imgDir, { recursive: true });
  const ext = (name.split(".").pop() || "png").toLowerCase() in { jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1 }
    ? (name.split(".").pop() || "png").toLowerCase()
    : "png";
  const saved = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(imgDir, saved), buf);
  db.run(
    "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
    [`/api/uploads/images/${saved}`, name.replace(/\.\w+$/, ""), desc, now, now],
  );
  return Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
}

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return Response.json({ detail: "解析表单失败" }, { status: 400 });
  }
  const type = String(form.get("type") || "characters");
  const cfg = TABLE[type];
  if (!cfg) return Response.json({ detail: "未知导入类型" }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const paste = String(form.get("content") || "").trim();
  if (!files.length && !paste) return Response.json({ detail: "请拖入/选择文件，或粘贴提示词" }, { status: 400 });
  if (files.length > 40) return Response.json({ detail: "单次最多导入 40 个文件" }, { status: 400 });

  const db = await getDb();
  const now = new Date().toISOString();

  // ---------- 1) 分类处理: 图片入库 / 文本汇总 / docx 提取文本+图片 ----------
  const texts: string[] = [];
  const imgIds: number[] = [];

  if (paste) {
    texts.push(paste);
  }
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const buf = Buffer.from(await f.arrayBuffer());
    if (IMG_EXT.includes(ext)) {
      const id = await saveImage(db, buf, f.name, "", now);
      if (id > 0) imgIds.push(id); // 尺寸不符(过小)已跳过
    } else if (ext === "docx") {
      // 文本
      let text = "";
      try { text = (await mammoth.extractRawText({ buffer: buf })).value || ""; } catch { /* ignore */ }
      if (text.trim()) texts.push(`--- 文件: ${f.name} ---\n${text.slice(0, TEXT_MAX)}`);
      // 内嵌图片
      try {
        await mammoth.convertToHtml({ buffer: buf }, {
          convertImage: mammoth.images.imgElement(async (img) => {
            const imageBuf = await img.read();
            const ctype = img.contentType || "";
            const iext = ctype.includes("png") ? "png" : ctype.includes("gif") ? "gif" : "jpg";
            const saved = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${iext}`;
            const imgDir = path.join(dataDir(), "uploads", "images");
            fs.mkdirSync(imgDir, { recursive: true });
            const savedFile = path.join(imgDir, saved);
            fs.writeFileSync(savedFile, imageBuf);
            // 尺寸源头拦截(过小不入库)
            const size = readImageSize(savedFile);
            if (size && size.w < 300) {
              fs.unlinkSync(savedFile);
              return { src: "" };
            }
            db.run(
              "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
              [`/api/uploads/images/${saved}`, `${f.name.replace(/\.\w+$/, "")}_图`, "word文档内嵌图片", now, now],
            );
            imgIds.push(Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0));
            return { src: `/api/uploads/images/${saved}` };
          }),
        });
      } catch { /* ignore */ }
    } else if (["txt", "md"].includes(ext)) {
      const text = buf.toString("utf8").slice(0, TEXT_MAX);
      if (text.trim()) texts.push(`--- 文件: ${f.name} ---\n${text}`);
    }
    // 其他扩展名: 跳过
  }

  if (!texts.length && !imgIds.length) {
    return Response.json({ detail: "没有可解析的文本或图片" }, { status: 400 });
  }

  // ---------- 2) 调豆包提取字段 ----------
  const result: { value: { name?: string; identity?: string[]; prompt?: string } | null } = { value: null };
  const apiKey = await getApiKey();
  if (!apiKey) return Response.json({ detail: "未配置 API Key(请点右上角 API Key 按钮设置)" }, { status: 500 });
  const modelId = process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";

  const sourceNote = files.length
    ? `用户提供了一组文件/文件夹内容(${files.length} 个文件, 内含图片 ${imgIds.length} 张已自动入库)。`
    : "用户直接粘贴了一大段提示词/描述(无文件)。";

  const userText = [
    `现在要把以下内容作为一条「${cfg.typeName}」对象导入资料库（${cfg.tip}）。`,
    sourceNote,
    "内容如下：",
    texts.join("\n\n").slice(0, TOTAL_MAX),
    "请提取该对象的 name(名称)、identity(按上述语义的标签数组, 可多个)、prompt(提示词)。",
    "prompt 规则：把内容中已直接提到的名称、identity 标签等「已知字段」剔除去掉后，整理为一段连贯、清晰、可直接用于 AI 创作/生图的提示词；若剔除后所剩不多, 则把内容总结成通顺的提示词(可适当补全细节, 但不要编造原文没有的核心设定)。",
    "请调用 extract_import 工具返回结果。",
  ].join("\n");

  const tool: ToolDef = {
    name: "extract_import",
    description: "从导入内容中提取资料库记录字段并返回",
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
    return Response.json({ detail: "AI 未能从内容中识别出名称" }, { status: 422 });
  }

  // ---------- 3) 写目标表 ----------
  const name = String(result.value.name).trim().slice(0, 80);
  const identity = Array.isArray(result.value.identity) ? result.value.identity.map((s) => String(s).trim()).filter(Boolean) : [];
  const prompt = String(result.value.prompt || "").trim() || "导入自内容";
  db.run(
    `INSERT INTO ${cfg.table}(name, identity, prompt, image_ids, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
    [name, JSON.stringify(identity), prompt, JSON.stringify(imgIds), now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();

  return Response.json({ ok: true, id, name, identity, prompt, images: imgIds, mode: paste ? "paste" : "file" });
}