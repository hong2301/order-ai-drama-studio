// AI 对话: 资料库(人物/场景/产品) + 剧本库 的 查询/修改/删除 工具
// 增已有 add_character/add_scene/add_product/add_script(见 api/chat/route.ts)
// 规则: 查询随时可调; 修改/删除必须先征得用户明确同意(参数 confirm=true 硬校验, 否则拒绝)
import fs from "fs";
import path from "path";
import { getDb, queryAll, queryOne, persist, normName, dataDir } from "@/lib/server/db";
import { contentKey, type LibraryTable } from "@/lib/server/library";
import type { ToolDef } from "@/lib/server/doubao";
import { readImageSize } from "@/lib/server/video";
import { availableVideoModelsBrief } from "@/lib/server/video/probeVideo";

// ---------- 名称/别名映射 ----------
const TABLE_ALIAS: Record<string, LibraryTable> = {
  character: "characters",
  "人物": "characters",
  scene: "scenes",
  "场景": "scenes",
  product: "products",
  "产品": "products",
};
const TABLE_LABEL: Record<LibraryTable, string> = {
  characters: "人物", scenes: "场景", products: "产品",
};
/** 三库 → 剧本里的物料引用列 */
const MATERIALS_COL: Record<LibraryTable, string> = {
  characters: "character_ids", scenes: "scene_ids", products: "product_ids",
};

function tableOf(args: Record<string, unknown>): LibraryTable | null {
  return TABLE_ALIAS[String(args.table || "").trim().toLowerCase()] ?? null;
}

/** JSON 数组安全解析(number[]) / (string[]) */
function parseNums(raw: unknown): number[] {
  try { return (JSON.parse(String(raw || "[]")) as unknown[]).filter((n): n is number => typeof n === "number"); } catch { return []; }
}
function parseStrs(raw: unknown): string[] {
  try { return (JSON.parse(String(raw || "[]")) as unknown[]).filter((s): s is string => typeof s === "string"); } catch { return []; }
}

/** 修改/删除类工具的同意校验: confirm 必须为 true, 否则拒绝(提醒 AI 先征得用户同意) */
function requireConfirm(args: Record<string, unknown>): string | null {
  if (args.confirm !== true && args.confirm !== "true") {
    return JSON.stringify({
      ok: false,
      detail: "这是修改/删除操作。请先用文字向用户说明要改/删的内容与影响, 得到用户明确同意后, 再以 confirm=true 调用本工具",
    });
  }
  return null;
}

// ---------- 查询: 资料库 ----------
const QUERY_LIB_TOOL: ToolDef = {
  name: "query_library",
  description:
    "查询资料库(人物/场景/产品)记录。用户问「库里有谁/有哪些场景/这个产品资料是什么/查一下xxx」等任何想了解库内数据的问题时随时调用; 修改/删除前也用它确认目标记录的 id 与现状。",
  parameters: {
    type: "object",
    properties: {
      table: { type: "string", enum: ["character", "scene", "product"], description: "库类型: character=人物 / scene=场景 / product=产品(也可写 人物/场景/产品)" },
      keyword: { type: "string", description: "按名称模糊搜索(可选, 不填列出全部)" },
      page: { type: "number", description: "页码, 默认 1" },
      page_size: { type: "number", description: "每页条数, 默认 10, 最大 50" },
    },
    required: ["table"],
  },
};

async function execQueryLibrary(args: Record<string, unknown>): Promise<string> {
  const table = tableOf(args);
  if (!table) return JSON.stringify({ ok: false, detail: "table 应为 character/scene/product(人物/场景/产品)" });
  const keyword = String(args.keyword || "").trim();
  const page = Math.max(1, Number(args.page) || 1);
  const size = Math.min(50, Math.max(1, Number(args.page_size) || 10));
  const db = await getDb();
  const where = keyword ? "WHERE name LIKE ?" : "";
  const wparams: unknown[] = keyword ? [`%${keyword}%`] : [];
  const total = Number(queryOne(db, `SELECT COUNT(*) AS n FROM ${table} ${where}`, wparams)?.n ?? 0);
  const rows = queryAll(
    db,
    `SELECT id, name, identity, prompt, image_ids, updated_at FROM ${table} ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...wparams, size, (page - 1) * size],
  );
  const items = rows.map((r) => {
    const prompt = String(r.prompt || "");
    return {
      id: r.id,
      name: r.name,
      identity: parseStrs(r.identity),
      prompt: prompt.length > 500 ? `${prompt.slice(0, 500)}…(已截断)` : prompt,
      图片数: parseNums(r.image_ids).length,
    };
  });
  return JSON.stringify({ ok: true, table: TABLE_LABEL[table], total, page, page_size: size, items });
}

// ---------- 查询: 剧本库 ----------
const QUERY_SCRIPT_TOOL: ToolDef = {
  name: "query_script",
  description:
    "查询剧本库中的剧本。传 script_id 查单集完整内容(含解析出的 人物/场景/产品/清晰度/时长/比例/关键词); 或传 keyword 按名称/内容搜索列表。用户问「有哪些剧本/找一下xx剧本/这集剧本内容是什么/第几集是什么」时调用。",
  parameters: {
    type: "object",
    properties: {
      script_id: { type: "number", description: "剧本 id(与 keyword 二选一, 传了则查这一条)" },
      keyword: { type: "string", description: "按名称/内容模糊搜索(可选)" },
      page: { type: "number", description: "关键词搜索时的页码, 默认 1" },
      page_size: { type: "number", description: "每页条数, 默认 10, 最大 50" },
    },
  },
};

async function execQueryScript(args: Record<string, unknown>): Promise<string> {
  const db = await getDb();
  const id = Number(args.script_id);
  if (Number.isInteger(id) && id > 0) {
    const r = queryOne(db, "SELECT * FROM scripts WHERE id=?", [id]);
    if (!r) return JSON.stringify({ ok: false, detail: `剧本 #${id} 不存在` });
    const content = String(r.content || "");
    return JSON.stringify({
      ok: true,
      script: {
        id: r.id,
        name: r.name,
        file_path: r.file_path,
        content: content.length > 8000 ? `${content.slice(0, 8000)}…(已截断)` : content,
        人物_ids: parseNums(r.character_ids),
        场景_ids: parseNums(r.scene_ids),
        产品_ids: parseNums(r.product_ids),
        resolution: r.resolution,
        duration: r.duration,
        ratio: r.ratio,
        keywords: parseStrs(r.keywords),
        updated_at: r.updated_at,
      },
    });
  }
  const keyword = String(args.keyword || "").trim();
  const page = Math.max(1, Number(args.page) || 1);
  const size = Math.min(50, Math.max(1, Number(args.page_size) || 10));
  const where = keyword ? "WHERE name LIKE ? OR content LIKE ?" : "";
  const wparams: unknown[] = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
  const total = Number(queryOne(db, `SELECT COUNT(*) AS n FROM scripts ${where}`, wparams)?.n ?? 0);
  const rows = queryAll(
    db,
    `SELECT id, name, resolution, duration, ratio, character_ids, scene_ids, product_ids, keywords, updated_at, substr(content,1,300) AS excerpt FROM scripts ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...wparams, size, (page - 1) * size],
  );
  return JSON.stringify({
    ok: true,
    total, page, page_size: size,
    scripts: rows.map((r) => ({
      id: r.id, name: r.name,
      resolution: r.resolution, duration: r.duration, ratio: r.ratio,
      人物数: parseNums(r.character_ids).length,
      场景数: parseNums(r.scene_ids).length,
      产品数: parseNums(r.product_ids).length,
      关键词: parseStrs(r.keywords),
      内容摘要: String(r.excerpt || ""),
      updated_at: r.updated_at,
    })),
  });
}

// ---------- 修改: 资料库(需用户确认) ----------
const UPDATE_LIB_TOOL: ToolDef = {
  name: "update_library",
  description:
    "修改资料库某条记录。人物库可改名称/身份标签/提示词; 场景库与产品库只有名称/提示词(没有标签字段)。还可**操控该记录的图片**(见 images 参数)。**修改前必须先向用户确认要改的字段与新内容, 用户明确同意(或用户直接点名要改某字段)后 confirm 传 true 才执行**; 未征得同意绝不要调用。修改后引用该记录的剧本会重新做一致性检查。",
  parameters: {
    type: "object",
    properties: {
      table: { type: "string", enum: ["character", "scene", "product"], description: "库类型" },
      id: { type: "number", description: "记录 id(query_library 可查得)" },
      name: { type: "string", description: "新名称(可选)" },
      identity: { type: "array", items: { type: "string" }, description: "新的身份/标签数组(可选)" },
      prompt: { type: "string", description: "新提示词(可选)" },
      images: {
        type: "string",
        enum: ["append", "replace", "clear"],
        description: "图片操作(可选): append=把用户**本轮对话上传的图片附件**追加为该记录的参考图(不覆盖已有, 多角度都保留); replace=用本轮图片整体替换该记录现有图片; clear=清空图片。不改图片就不要传。要求用户本轮确实发了图。",
      },
      confirm: { type: "boolean", description: "用户明确同意修改后传 true, 否则不要调用" },
    },
    required: ["table", "id", "confirm"],
  },
};

async function execUpdateLibrary(args: Record<string, unknown>, imageUrls: string[] = []): Promise<string> {
  const deny = requireConfirm(args);
  if (deny) return deny;
  const table = tableOf(args);
  if (!table) return JSON.stringify({ ok: false, detail: "table 应为 character/scene/product(人物/场景/产品)" });
  const id = Number(args.id);
  if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ ok: false, detail: "id 不合法" });
  const db = await getDb();
  const exist = queryOne(db, `SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!exist) return JSON.stringify({ ok: false, detail: `${TABLE_LABEL[table]}记录 #${id} 不存在` });

  const newName = (args.name !== undefined && args.name !== null) ? String(args.name).trim() : String(exist.name || "");
  if (!newName) return JSON.stringify({ ok: false, detail: "名称不能为空" });
  let newIdentity = String(exist.identity || "[]");
  // 仅人物库有身份标签字段; 场景/产品库忽略 identity
  if (table === "characters" && args.identity !== undefined && args.identity !== null) {
    const arr = Array.isArray(args.identity) ? (args.identity as unknown[]).map(String) : [];
    newIdentity = JSON.stringify([...new Set(arr.map((t) => t.trim()).filter(Boolean))]);
  }
  let newPrompt = String(exist.prompt || "");
  if (args.prompt !== undefined && args.prompt !== null) newPrompt = String(args.prompt).trim();

  // 图片操作: append/replace 用「用户本轮上传的附件图」; clear 清空
  let newImages = String(exist.image_ids || "[]");
  const imgOp = String(args.images || "").trim();
  if (imgOp) {
    if (imgOp === "clear") {
      newImages = "[]";
    } else if (imgOp === "append" || imgOp === "replace") {
      const cur = parseNums(newImages);
      const incoming = await registerChatImages(imageUrls);
      if (!incoming.length) {
        return JSON.stringify({ ok: false, detail: "本轮对话里没有图片附件: 请先把图片发给我, 再说“加到这条记录上”" });
      }
      newImages = JSON.stringify(imgOp === "append" ? [...new Set([...cur, ...incoming])] : incoming);
    } else {
      return JSON.stringify({ ok: false, detail: "images 只支持 append / replace / clear" });
    }
  }

  const nameOrPromptChanged = newName !== String(exist.name) || newPrompt !== String(exist.prompt);
  const identityChanged = newIdentity !== String(exist.identity);
  const imagesChanged = newImages !== String(exist.image_ids);
  if (!nameOrPromptChanged && !identityChanged && !imagesChanged) {
    return JSON.stringify({ ok: true, detail: "内容没有变化, 未执行更新" });
  }
  db.run(
    `UPDATE ${table} SET name=?, identity=?, prompt=?, image_ids=?, content_key=?, name_key=?, updated_at=? WHERE id=?`,
    [newName, newIdentity, newPrompt, newImages, contentKey(newName, newPrompt), normName(newName), new Date().toISOString(), id],
  );
  // 名称/提示词变化 → 引用它的剧本下次生成重新做一致性适配(精确匹配, 避免 id 子串误伤)
  if (nameOrPromptChanged) {
    const col = MATERIALS_COL[table];
    const scripts = queryAll(db, `SELECT id, ${col} FROM scripts`);
    for (const s of scripts) {
      if (parseNums(s[col]).includes(id)) {
        db.run(`UPDATE scripts SET materials_fp='' WHERE id=?`, [Number(s.id)]);
      }
    }
  }
  await persist();
  const imgCount = parseNums(newImages).length;
  return JSON.stringify({
    ok: true, id, name: newName, images: imgCount,
    detail: `${TABLE_LABEL[table]} #${id}「${newName}」已更新, 现有图片 ${imgCount} 张${imagesChanged ? "(图片已变更)" : ""}`,
  });
}

// ---------- 修改: 剧本(需用户确认, 内容变化后自动重新解析) ----------
const UPDATE_SCRIPT_TOOL: ToolDef = {
  name: "update_script",
  description:
    "修改剧本库中某集剧本的名称/完整内容。**修改前必须先向用户确认, 用户明确同意后 confirm 传 true 才执行**。注意: 修改剧本内容会自动重新解析人物/场景/产品(向三库新增或合并), 影响较大, 务必先跟用户确认改动内容。",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "剧本 id(query_script 可查得)" },
      name: { type: "string", description: "新名称(可选)" },
      content: { type: "string", description: "新的完整剧本文本(可选)" },
      confirm: { type: "boolean", description: "用户明确同意修改后传 true, 否则不要调用" },
    },
    required: ["id", "confirm"],
  },
};

async function execUpdateScript(args: Record<string, unknown>): Promise<string> {
  const deny = requireConfirm(args);
  if (deny) return deny;
  const id = Number(args.id);
  if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ ok: false, detail: "id 不合法" });
  const db = await getDb();
  const exist = queryOne(db, "SELECT * FROM scripts WHERE id=?", [id]);
  if (!exist) return JSON.stringify({ ok: false, detail: `剧本 #${id} 不存在` });

  const sets: string[] = [];
  const vals: unknown[] = [];
  let contentChanged = false;
  if (args.content !== undefined && args.content !== null) {
    const next = String(args.content);
    sets.push("content=?");
    vals.push(next);
    contentChanged = next !== String(exist.content);
  }
  if (args.name !== undefined && args.name !== null) {
    sets.push("name=?");
    vals.push(String(args.name).trim() || String(exist.name));
  }
  if (contentChanged) { sets.push("materials_fp=?"); vals.push(""); }
  if (!sets.length) return JSON.stringify({ ok: true, detail: "没有可更新的字段" });
  sets.push("updated_at=?");
  vals.push(new Date().toISOString());
  db.run(`UPDATE scripts SET ${sets.join(",")} WHERE id=?`, [...vals, id]);
  await persist();

  // 内容变化 → 自动重新解析(三库同步新增/合并, 与 AI 添加入库行为一致)
  let parse = null;
  if (contentChanged) {
    try {
      const { parseScript } = await import("@/lib/server/scriptParse");
      parse = await parseScript(id);
    } catch { /* 解析失败不影响更新 */ }
  }
  return JSON.stringify({
    ok: true, id,
    detail: contentChanged ? "剧本已更新并自动重新解析" : "剧本已更新",
    reparse: contentChanged ? "已重新解析" : undefined,
  });
}

// ---------- 删除: 资料库(需用户确认, 不可恢复; 自动清理剧本引用) ----------
const DELETE_LIB_TOOL: ToolDef = {
  name: "delete_library",
  description:
    "删除资料库(人物/场景/产品)某条记录, **删除不可恢复**。删除前必须先向用户确认要删除的记录与其影响(若被剧本引用, 会同时从相关剧本的物料关联里移除), 用户明确同意后 confirm 传 true 才执行; 用户未同意绝不调用。",
  parameters: {
    type: "object",
    properties: {
      table: { type: "string", enum: ["character", "scene", "product"], description: "库类型" },
      id: { type: "number", description: "记录 id" },
      confirm: { type: "boolean", description: "用户明确同意删除后传 true, 否则不要调用" },
    },
    required: ["table", "id", "confirm"],
  },
};

async function execDeleteLibrary(args: Record<string, unknown>): Promise<string> {
  const deny = requireConfirm(args);
  if (deny) return deny;
  const table = tableOf(args);
  if (!table) return JSON.stringify({ ok: false, detail: "table 应为 character/scene/product(人物/场景/产品)" });
  const id = Number(args.id);
  if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ ok: false, detail: "id 不合法" });
  const db = await getDb();
  const exist = queryOne(db, `SELECT id, name FROM ${table} WHERE id=?`, [id]);
  if (!exist) return JSON.stringify({ ok: false, detail: `${TABLE_LABEL[table]}记录 #${id} 不存在` });

  db.run(`DELETE FROM ${table} WHERE id=?`, [id]);
  // 从剧本引用数组移除该 id + 受影响剧本重新做一致性检查
  let refChanged = 0;
  const col = MATERIALS_COL[table];
  const scripts = queryAll(db, `SELECT id, ${col} FROM scripts`);
  for (const s of scripts) {
    const ids = parseNums(s[col]);
    if (!ids.includes(id)) continue;
    db.run(`UPDATE scripts SET ${col}=?, materials_fp='' WHERE id=?`, [JSON.stringify(ids.filter((n) => n !== id)), Number(s.id)]);
    refChanged++;
  }
  await persist();
  return JSON.stringify({
    ok: true,
    detail: `已删除${TABLE_LABEL[table]}「${String(exist.name)}」#${id}${refChanged ? `, 并已从 ${refChanged} 个剧本的物料关联中移除` : ""}`,
  });
}

// ---------- 删除: 剧本(需用户确认, 不可恢复) ----------
const DELETE_SCRIPT_TOOL: ToolDef = {
  name: "delete_script",
  description:
    "删除剧本库中某一集剧本, **删除不可恢复**(若该剧本已生成过视频, 视频库成片保留)。删除前必须先向用户确认是哪一集及其影响, 用户明确同意后 confirm 传 true 才执行; 用户未同意绝不调用。",
  parameters: {
    type: "object",
    properties: {
      id: { type: "number", description: "剧本 id" },
      confirm: { type: "boolean", description: "用户明确同意删除后传 true, 否则不要调用" },
    },
    required: ["id", "confirm"],
  },
};

async function execDeleteScript(args: Record<string, unknown>): Promise<string> {
  const deny = requireConfirm(args);
  if (deny) return deny;
  const id = Number(args.id);
  if (!Number.isInteger(id) || id <= 0) return JSON.stringify({ ok: false, detail: "id 不合法" });
  const db = await getDb();
  const exist = queryOne(db, "SELECT id, name FROM scripts WHERE id=?", [id]);
  if (!exist) return JSON.stringify({ ok: false, detail: `剧本 #${id} 不存在` });
  db.run("DELETE FROM scripts WHERE id=?", [id]);
  await persist();
  return JSON.stringify({ ok: true, detail: `已删除剧本「${String(exist.name)}」#${id}` });
}

// ---------- 对话附件图片 → 图库(供 AI 写库时自动关联) ----------
const IMG_EXTS = ["jpg", "jpeg", "jfif", "png", "gif", "webp"];

/**
 * 把本轮对话的图片附件登记进图库(文件从 uploads/chat 复制到 uploads/images, 同名路径复用已有记录),
 * 返回图片 id 列表 — 供 add_character/add_scene/add_product 写库时自动关联
 */
export async function registerChatImages(urls: string[]): Promise<number[]> {
  if (!urls.length) return [];
  const db = await getDb();
  const dstDir = path.join(dataDir(), "uploads", "images");
  const ids: number[] = [];
  for (const u of urls) {
    const m = /^\/api\/uploads\/chat\/([\w.-]+)$/.exec(u);
    if (!m) continue;
    const file = path.basename(m[1]);
    const ext = (file.split(".").pop() || "").toLowerCase();
    if (!IMG_EXTS.includes(ext)) continue;
    const src = path.join(dataDir(), "uploads", "chat", file);
    if (!fs.existsSync(src)) continue;
    try {
      fs.mkdirSync(dstDir, { recursive: true });
      const dst = path.join(dstDir, file);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
      // 尺寸源头拦截: 过小图(宽<300px)不转图库(避免日后图生被拒)
      const size = readImageSize(dst);
      if (size && size.w < 300) continue;
    } catch { continue; }
    const imgPath = `/api/uploads/images/${file}`;
    const exist = queryOne(db, "SELECT id FROM images WHERE path=?", [imgPath]);
    if (exist) { ids.push(Number(exist.id)); continue; }
    const now = new Date().toISOString();
    db.run(
      "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
      [imgPath, file.replace(/\.[^.]+$/, ""), "", now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    if (id) ids.push(id);
  }
  if (ids.length) await persist();
  return ids;
}

// ---------- 视频模型可用性探测(AI 真实依据, 非静态猜测) ----------
const QUERY_VIDEO_MODELS_TOOL: ToolDef = {
  name: "query_video_models",
  description:
    "查询当前账号真实可用的视频生成模型(实时探测方舟, 结果 24h 缓存)。用户问「我能用哪些视频模型/哪个模型没开通/生成视频选哪个模型」时调用; 生成前拿不准可用性时也可以先查。切记: 是否开通一律以本工具结果为准, 不要凭模型名称或描述猜测。",
  parameters: { type: "object", properties: {} },
};

async function execQueryVideoModels(_args: Record<string, unknown>): Promise<string> {
  const brief = await availableVideoModelsBrief();
  return JSON.stringify({ ok: true, detail: `视频模型可用性(探测结果): ${brief}` });
}

// ---------- 注册表(route.ts 统一挂载) ----------
export const DATA_TOOLS: ToolDef[] = [
  QUERY_VIDEO_MODELS_TOOL,
  QUERY_LIB_TOOL, QUERY_SCRIPT_TOOL,
  UPDATE_LIB_TOOL, UPDATE_SCRIPT_TOOL,
  DELETE_LIB_TOOL, DELETE_SCRIPT_TOOL,
];

/** 工具名 → 执行函数; 返回 null 表示不是本文件负责的工具 */
const HANDLERS: Record<string, (args: Record<string, unknown>, imageUrls?: string[]) => Promise<string>> = {
  query_video_models: execQueryVideoModels,
  query_library: execQueryLibrary,
  query_script: execQueryScript,
  update_library: execUpdateLibrary,
  update_script: execUpdateScript,
  delete_library: execDeleteLibrary,
  delete_script: execDeleteScript,
};

/** 写操作(改/删) → 库已变, 前端应刷新 */
export const DATA_TOOL_WRITES = new Set(["update_library", "update_script", "delete_library", "delete_script"]);

export function execDataTool(name: string, args: Record<string, unknown>, imageUrls: string[] = []): (() => Promise<string>) | null {
  const fn = HANDLERS[name];
  return fn ? () => fn(args, imageUrls) : null;
}