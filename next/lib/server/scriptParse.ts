// 剧本解析: 从剧本内容识别【人物/场景/产品】→ 三库查重写入并关联;
// 同时提取 清晰度/时长/比例 + 关键词(剔除已知信息). 供添加时自动调用与右键手动解析共用
import { chat, type ToolDef } from "@/lib/server/doubao";
import { getDb, persist, queryOne, queryAll, getSetting, getApiKey } from "@/lib/server/db";
import { upsertLibraryRecord } from "@/lib/server/library";
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
            image_index: { type: "integer", description: "对应附件图片的序号(从 1 开始, 按附图顺序); 没有对应图片则不填" },
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
            image_index: { type: "integer", description: "对应附件图片的序号(从 1 开始, 按附图顺序); 没有对应图片则不填" },
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
            image_index: { type: "integer", description: "对应附件图片的序号(从 1 开始, 按附图顺序); 没有对应图片则不填" },
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

/** 提取剧本内容里的图片地址(HTML img / Markdown 图片, 保序去重) */
function extractImageUrls(content: string): string[] {
  const out: string[] = [];
  const push = (u: string): void => { const s = u.trim(); if (s && !out.includes(s)) out.push(s); };
  for (const m of content.matchAll(/<img[^>]*src=["']([^"']+)["']/g)) push(m[1]);
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) push(m[1]);
  return out;
}

/** 图片URL -> data URL(仅本地 uploads 路径; ≤10MB) */
function imageToDataUrl(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  const file = path.join(dataDir(), "uploads", m[1], m[2]);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  if (!mime[ext]) return null;
  if (fs.statSync(file).size > 10 * 1024 * 1024) return null;
  return `data:${mime[ext]};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** 解析一个剧本(幂等): 返回 {ok, detail?, summary?} */
export async function parseScript(scriptId: number): Promise<{ ok: boolean; detail?: string; summary?: string }> {
  const db = await getDb();
  const row = queryOne(db, "SELECT * FROM scripts WHERE id=?", [scriptId]);
  if (!row) { log(`解析失败 剧本${scriptId}: 不存在`); return { ok: false, detail: "剧本不存在" }; }
  const text = plainText(String(row.content || ""));
  if (!text) { log(`解析失败 剧本${scriptId}: 内容为空`); return { ok: false, detail: "剧本内容为空，无法解析" }; }

  const apiKey = await getApiKey();
  if (!apiKey){ log(`解析失败 剧本${scriptId}: 未配置 API Key(请右上角设置)`); return { ok: false, detail: "未配置 API Key" }; }
  // 解析模型与 AI 对话模块当前选择同步(无则用环境变量默认)
  const modelId = await getSetting("chat_model", process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428");

  // 剧本里的图片: 提取 → data URL(供模型识别, 再匹配到人物/场景/产品上)
  const imgUrls = extractImageUrls(String(row.content || ""));
  const imgDataUrls = imgUrls.map(imageToDataUrl).filter((x): x is string => !!x).slice(0, 8);

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
    imgDataUrls.length
      ? `7) 另附剧本中的 ${imgDataUrls.length} 张图片(按附图顺序编号 1..${imgDataUrls.length})。请识别每张图片内容, 判断它属于哪个人物/场景/产品, 在对应条目的 image_index 填图片序号(无匹配则不填)`
      : "7) 本次没有附件图片, 不需要填 image_index",
  ].join("\n");

  const result: { value: Record<string, unknown> | null } = { value: null };
  try {
    await chat(apiKey, modelId, [{ role: "user", content: prompt, images: imgDataUrls }], {
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

  // 三库查重/写入(同名同提示词 → 去重合并身份); 图片按 AI 匹配的 image_index 关联到 images 表
  const now = new Date().toISOString();
  /** image_index(图片序号) → images 表 id 数组(已存在则复用) */
  const imgIdsFor = (idx: unknown): number[] => {
    const n = Number(idx);
    if (!Number.isInteger(n) || n < 1 || n > imgUrls.length) return [];
    const url = imgUrls[n - 1];
    const existImg = queryOne(db, "SELECT id FROM images WHERE path=?", [url]);
    if (existImg) return [Number(existImg.id)];
    db.run(
      "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
      [url, `剧本图${n}`, `剧本《${String(row.name || "")}》第 ${n} 张图`, now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    return id ? [id] : [];
  };
  const charIds: number[] = [];
  const sceneIds: number[] = [];
  const prodIds: number[] = [];
  for (const item of v.characters as Record<string, unknown>[]) {
    try {
      const r = await upsertLibraryRecord("characters", {
        name: String(item.name || ""),
        identity: Array.isArray(item.identity) ? (item.identity as unknown[]).map(String) : [],
        prompt: String(item.prompt || ""),
        image_ids: imgIdsFor(item.image_index),
      });
      charIds.push(r.id);
    } catch { /* ignore */ }
  }
  for (const item of v.scenes as Record<string, unknown>[]) {
    try {
      const r = await upsertLibraryRecord("scenes", {
        name: String(item.name || ""),
        identity: Array.isArray(item.identity) ? (item.identity as unknown[]).map(String) : [],
        prompt: String(item.prompt || ""),
        image_ids: imgIdsFor(item.image_index),
      });
      sceneIds.push(r.id);
    } catch { /* ignore */ }
  }
  for (const item of v.products as Record<string, unknown>[]) {
    try {
      const r = await upsertLibraryRecord("products", {
        name: String(item.name || ""),
        identity: Array.isArray(item.identity) ? (item.identity as unknown[]).map(String) : [],
        prompt: String(item.prompt || ""),
        image_ids: imgIdsFor(item.image_index),
      });
      prodIds.push(r.id);
    } catch { /* ignore */ }
  }
  const keywords = Array.isArray(v.keywords) ? v.keywords.map((s) => String(s).trim()).filter(Boolean).slice(0, 10) : [];

  // 物料指纹: 解析出的 人物/场景/产品 快照(三库内容/勾选变化时比对用, 生成时决定是否需一致性适配)
  const { materialsFp } = await import("@/lib/server/video/adapt");
  const fpMats = (table: "characters" | "scenes" | "products", ids: number[]): { name: string; prompt: string }[] => {
    if (!ids.length) return [];
    const rows = queryAll(db, `SELECT name, prompt FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    return rows.map((r) => ({ name: String(r.name || ""), prompt: String(r.prompt || "") }));
  };
  const materialsFingerprint = materialsFp(
    fpMats("characters", charIds),
    fpMats("scenes", sceneIds),
    fpMats("products", prodIds),
  );

  db.run(
    "UPDATE scripts SET character_ids=?, scene_ids=?, product_ids=?, resolution=?, duration=?, ratio=?, keywords=?, materials_fp=?, updated_at=? WHERE id=?",
    [
      JSON.stringify(charIds), JSON.stringify(sceneIds), JSON.stringify(prodIds),
      String(v.resolution || "").trim(), String(v.duration || "").trim(), String(v.ratio || "").trim(),
      JSON.stringify(keywords), materialsFingerprint, now, scriptId,
    ],
  );
  await persist();
  log(`解析完成 剧本${scriptId}(${String(row.name)}): ${charIds.length}人物/${sceneIds.length}场景/${prodIds.length}产品 ${String(v.resolution || "")} ${String(v.duration || "")}秒`);

  return {
    ok: true,
    summary: `人物${charIds.length} · 场景${sceneIds.length} · 产品${prodIds.length}${v.resolution ? ` · ${String(v.resolution)}` : ""}${v.duration ? ` · ${String(v.duration)}秒` : ""}`,
  };
}