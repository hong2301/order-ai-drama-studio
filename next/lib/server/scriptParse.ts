// 剧本解析: 从剧本内容识别【人物/场景/产品】→ 三库查重写入并关联;
// 同时提取 清晰度/时长/比例 + 关键词(剔除已知信息). 供添加时自动调用与右键手动解析共用
import { chat, type ToolDef } from "@/lib/server/doubao";
import { getDb, persist, queryOne } from "@/lib/server/db";
import type { Database } from "sql.js";

const TEXT_MAX = 8000;

const PARSE_TOOL: ToolDef = {
  name: "parse_script",
  description: "从剧本内容中解析出人物/场景/产品、清晰度/时长/比例与关键词",
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
            prompt: { type: "string", description: "该角色的简要提示词/描述" },
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
            prompt: { type: "string", description: "场景描述提示词" },
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
            prompt: { type: "string", description: "产品描述提示词" },
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

/** 查重或写入某资料库表, 返回记录 id */
function upsertRecord(
  db: Database,
  table: "characters" | "scenes" | "products",
  item: Record<string, unknown>,
  now: string,
): number | null {
  const name = String(item.name ?? "").trim();
  if (!name) return null;
  const exist = queryOne(db, `SELECT id FROM ${table} WHERE name=?`, [name]);
  if (exist) return Number(exist.id);
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
  if (!row) return { ok: false, detail: "剧本不存在" };
  const text = plainText(String(row.content || ""));
  if (!text) return { ok: false, detail: "剧本内容为空，无法解析" };

  const apiKey = process.env.DOUBAO_API_KEY || "";
  if (!apiKey) return { ok: false, detail: "未配置 DOUBAO_API_KEY" };
  const modelId = process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";

  const prompt = [
    "你是视频短剧的剧本解析助手。以下是剧本内容：",
    "「" + text.slice(0, TEXT_MAX) + "」",
    `剧本共 ${text.length} 字。请调用 parse_script 工具解析：`,
    "1) characters: 剧本明确涉及的人物(每个给 name/identity 身份标签/prompt 简述); 没有就空数组",
    "2) scenes: 出现的场景(每个给 name/identity 类型标签/prompt 描述); 没有就空数组",
    "3) products: 出现的产品(每个给 name/identity 品类标签/prompt 描述); 没有就空数组",
    "4) resolution/duration/ratio: 仅当剧本明确提到清晰度/时长/画面比例时提取, 否则留空字符串",
    "5) keywords: 关键词 3~8 个——必须剔除 characters/scenes/products 的名称和身份标签等已知信息后, 提炼题材/风格/情绪/情节关键词(如 亲情/怀旧/带货/反转)",
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
  } catch {
    return { ok: false, detail: "AI 解析调用失败" };
  }
  const v = result.value;
  if (!v) return { ok: false, detail: "AI 未能解析剧本" };

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

  return {
    ok: true,
    summary: `人物${charIds.length} · 场景${sceneIds.length} · 产品${prodIds.length}${v.resolution ? ` · ${String(v.resolution)}` : ""}${v.duration ? ` · ${String(v.duration)}秒` : ""}`,
  };
}