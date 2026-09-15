// 剧本解析: 从剧本内容识别【人物/场景/产品】→ 三库查重写入并关联;
// 同时提取 清晰度/时长/比例 + 关键词(剔除已知信息). 供添加时自动调用与右键手动解析共用
import { chat, type ToolDef } from "@/lib/server/doubao";
import { getDb, persist, queryOne, getSetting } from "@/lib/server/db";
import type { Database } from "sql.js";
import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/server/db";

/** 服务端日志: data/logs/server.log(与 Electron main.log 并列) */
export function log(msg: string): void {
  try {
    const dir = path.join(dataDir(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "server.log"), `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

const TEXT_MAX = 8000;

const PARSE_TOOL: ToolDef = {
  name: "parse_script",
  description: "从剧本内容中解析出人物/场景/产品、清晰度/时长/比例与关键词。注意: 各项 prompt 只写该对象用于画面生成的视觉描述, 不要包含身份/类型标签、清晰度/时长/比例等配置信息(它们已有独立字段, 生成时会另行拼接)。",
  parameters: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "角色名称" },
            identity: { type: "array", items: { type: "string" }, description: "身份标签数组, 如 主角/婆婆" },
            prompt: { type: "string", description: "角色的视觉画面描述提示词(年龄外貌/服装/气质等, 不含身份标签与视频配置)" },
          },
          required: ["name"],
        },
      },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "场景名称" },
            identity: { type: "array", items: { type: "string" }, description: "类型标签数组, 如 客厅/夜晚" },
            prompt: { type: "string", description: "场景视觉描述提示词(环境/灯光/色调等, 不含类型标签与视频配置)" },
          },
          required: ["name"],
        },
      },
      products: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "产品名称" },
            identity: { type: "array", items: { type: "string" }, description: "品类标签数组, 如 保健品" },
            prompt: { type: "string", description: "产品外观/卖点画面描述提示词(包装/质感等, 不含品类标签与视频配置)" },
          },
          required: ["name"],
        },
      },
      resolution: { type: "string", description: "清晰度, 如 1080P/720P(剧本未提及则为空)" },
      duration: { type: "string", description: "时长(秒), 如 15(剧本未提及则为空)" },
      ratio: { type: "string", description: "画面比例, 如 9:16/16:9(剧本未提及则为空)" },
      keywords: { type: "array", items: { type: "string" }, description: "剔除人物/场景/产品名称与标签等已知信息后的关键词, 如 亲情/怀旧/带货/反转, 3~8个" },
    },
    required: ["characters", "scenes", "products", "keywords"],
  },
};

/** 内容转纯文本(docx 导入会带 HTML 标签) */
function plainText(content: string): string {
  return content.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** 写入资料库表(同名也新建 — 提示词等可能不一致, 不按名称合并) */
function upsertRecord(
  db: Database,
  table: "characters" | "scenes" | "products",
  item: Record<string, unknown>,
  now: string,
): number | null {
  const name = String(item.name ?? "").trim();
  if (!name) return null;
  const identity = Array.isArray(item.identity) ? item.identity.map((s) => String(s).trim()).filter(Boolean) : [];
  const prompt = String(item.prompt ?? "").trim().slice(0, 2000);
  db.run(
    `INSERT INTO ${table}(name, identity, prompt, image_ids, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
    [name, JSON.stringify(identity), prompt, "[]", now, now],
  );
  return Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
}

/** 解析一个剧本(幂等): 返回 {ok, detail?, summary?} */
export async function parseScript(scriptId: number): Promise<{ ok: boolean; detail?: string; summary?: string }> {
  const db = await getDb();
  const row = queryOne(db, "SELECT * FROM scripts WHERE id=?", [scriptId]);
  if (!row) { log(`解析失败 剧本${scriptId}: 不存在`); return { ok: false, detail: "剧本不存在" }; }
  const text = plainText(String(row.content || ""));
  if (!text) { log(`解析失败 剧本${scriptId}: 内容为空`); return { ok: false, detail: "剧本内容为空，无法解析" }; }

  const apiKey = process.env.DOUBAO_API_KEY || "";
  if (!apiKey){ log(`解析失败 剧本${scriptId}: 未配置 DOUBAO_API_KEY`); return { ok: false, detail: "未配置 DOUBAO_API_KEY" }; }
  // 解析模型与 AI 对话模块当前选择同步(无则用环境变量默认)
  const modelId = await getSetting("chat_model", process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428");

  const prompt = [
    "你是视频短剧的剧本解析助手。以下是剧本内容：",
    "「" + text.slice(0, TEXT_MAX) + "」",
    `剧本共 ${text.length} 字。请调用 parse_script 工具解析：`,
    "1) characters: 剧本明确涉及的人物(每个给 name/identity 身份标签/prompt 简述); 没有就空数组",
    "2) scenes: 出现的场景(每个给 name/identity 类型标签/prompt 描述); 没有就空数组",
    "3) products: 出现的产品(每个给 name/identity 品类标签/prompt 描述); 没有就空数组",
    "4) resolution/duration/ratio: 仅当剧本明确提到清晰度/时长/画面比例时提取, 否则留空字符串",
    "5) keywords: 关键词 3~8 个——必须剔除 characters/scenes/products 的名称和身份标签等已知信息后, 提炼题材/风格/情绪/情节关键词(如 亲情/怀旧/带货/反转)",
    "6) 重要: 各 prompt 只写画面/视觉描述(如角色外貌服装、场景环境光线、产品外观质感), 严禁把 身份/类型标签、清晰度/时长/比例 等配置信息写进 prompt——它们是独立字段, 生成视频时会另行拼接成完整提示词",
  ].join("\n");

  const result: { value: Record<string, unknown> | null } = { value: null };
  try {
    await chat(apiKey, modelId, [{ role: "user", content: prompt }], {
      tools: [PARSE_TOOL],
      onToolCall: async (name, args) => {
        if (name === "parse_script") { result.value = args; return JSON.stringify({ ok: true }); }
        return JSON.stringify({ ok: false, detail: `未知工具 ${name}` });
      },
    });
  } catch (e) {
    log(`解析失败 剧本${scriptId}: ${(e as Error).message}`);
    return { ok: false, detail: "AI 解析调用失败" };
  }
  const v = result.value;
  if (!v) { log(`解析失败 剧本${scriptId}: AI 未返回解析结果`); return { ok: false, detail: "AI 未能解析剧本" }; }

  // 三库查重/写入
  const now = new Date().toISOString();
  const charIds: number[] = [];
  const sceneIds: number[] = [];
  const prodIds: number[] = [];
  for (const item of v.characters as Record<string, unknown>[]) {
    const id = upsertRecord(db, "characters", item, now);
    if (id != null) charIds.push(id);
  }
  for (const item of v.scenes as Record<string, unknown>[]) {
    const id = upsertRecord(db, "scenes", item, now);
    if (id != null) sceneIds.push(id);
  }
  for (const item of v.products as Record<string, unknown>[]) {
    const id = upsertRecord(db, "products", item, now);
    if (id != null) prodIds.push(id);
  }
  const keywords = Array.isArray(v.keywords) ? v.keywords.map((s) => String(s).trim()).filter(Boolean).slice(0, 10) : [];

  db.run(
    "UPDATE scripts SET character_ids=?, scene_ids=?, product_ids=?, resolution=?, duration=?, ratio=?, keywords=?, updated_at=? WHERE id=?",
    [
      JSON.stringify(charIds), JSON.stringify(sceneIds), JSON.stringify(prodIds),
      String(v.resolution || "").trim(), String(v.duration || "").trim(), String(v.ratio || "").trim(),
      JSON.stringify(keywords), now, scriptId,
    ],
  );
  await persist();
  log(`解析完成 剧本${scriptId}(${String(row.name)}): ${charIds.length}人物/${sceneIds.length}场景/${prodIds.length}产品 ${String(v.resolution || "")} ${String(v.duration || "")}秒`);

  return {
    ok: true,
    summary: `人物${charIds.length} · 场景${sceneIds.length} · 产品${prodIds.length}${v.resolution ? ` · ${String(v.resolution)}` : ""}${v.duration ? ` · ${String(v.duration)}秒` : ""}`,
  };
}