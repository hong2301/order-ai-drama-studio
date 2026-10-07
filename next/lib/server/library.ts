// 三库(人物/场景/产品)去重合并: 以名称归一化 + 「名称+提示词」生成去重键
// 同名(容错细微字符差异) → 合并身份/图片, 提示词用 AI 融合(保留双方信息); 避免重复记录
import crypto from "crypto";
import { getDb, persist, queryOne, queryAll, normName } from "@/lib/server/db";
import { getAuxModel, getApiKey } from "@/lib/server/db";
import { chat } from "@/lib/server/doubao";
import type { Database } from "sql.js";

const TABLES = ["characters", "scenes", "products"] as const;
export type LibraryTable = (typeof TABLES)[number];

// 同一「表 + 名称」的写入串行化锁。
// 原因: 同名合并要先查库再调 AI 融合, 而 AI 要跑几秒~几十秒 —— 这段 await 窗口里
// 另一个同名写入查库仍是"不存在", 于是各建一条重复记录(用 AI 判断合并的固有代价)。
// 挂 globalThis: Next 按 route 分包, 模块级变量会各持一份。
const GL = globalThis as unknown as { __libNameLocks?: Map<string, Promise<void>> };
const nameLocks = (GL.__libNameLocks ??= new Map<string, Promise<void>>());

async function withNameLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = nameLocks.get(key) ?? Promise.resolve();
  const task = prev.then(fn, fn);                       // 前一个失败也继续, 不阻塞队列
  const tail = task.then(() => undefined, () => undefined);
  nameLocks.set(key, tail);
  try {
    return await task;
  } finally {
    if (nameLocks.get(key) === tail) nameLocks.delete(key);   // 自己是队尾就回收, 避免 Map 无限增长
  }
}

/** 名称+提示词 → 去重键(sha1 前 20 位, 同名同提示词必相同) */
export function contentKey(name: string, prompt: string): string {
  return crypto.createHash("sha1").update(`${name}\u0000${prompt}`).digest("hex").slice(0, 20);
}

/**
 * 提示词融合: 同名对象的新旧描述合并为一段更完整的提示词
 * (包含关系直接取更全的; 否则用 AI 融合, AI 不可用时取更长的)
 */
async function mergePrompts(name: string, oldP: string, newP: string): Promise<string> {
  const a = oldP.trim();
  const b = newP.trim();
  // ---- 确定性分支优先(不调 AI): 空 / 相同 / 包含 / 长短悬殊 ----
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  const longer = b.length > a.length ? b : a;
  const shorter = b.length > a.length ? a : b;
  // 长短差一倍以上: 更全的那份明显包含更多信息, 直接取更全的(少一次主观判断, 也省钱)
  if (longer.length >= shorter.length * 2) return longer;
  const apiKey = await getApiKey();
  if (!apiKey) return longer;
  try {
    const model = await getAuxModel();
    // 融合限 60s: 同名写入在排队等这把锁, 不能让一次慢响应把整条队列拖长(超时则降级取更全原文)
    const out = await Promise.race([
      chat(apiKey, model, [{
        role: "user",
        content: [
          `以下是同一个对象「${name}」的两段画面描述提示词, 请融合成一段完整、不重复、不矛盾的提示词。`,
          `A: ${a}`,
          `B: ${b}`,
          "要求(严格): 只能使用 A 与 B 中已经出现的信息, 不得新增任何 A/B 之外的内容; 保留两者全部有效信息(外貌/服装/材质/光线等); 去除重复表述; 中文一段话;",
          `篇幅不得超过较长原文的 1.2 倍(即约 ${Math.ceil(longer.length * 1.2)} 字以内); 只输出融合结果, 不要解释。`,
        ].join("\n"),
      }]),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("merge timeout")), 60000)),
    ]);
    const merged = out.trim();
    // 护栏: AI 输出超出原文信息量的迹象(空/过短/爆长)一律判为不可靠, 降级取更全的原文 ——
    // 避免"融合"变成模型自由发挥, 把描述越写越跑偏
    const limit = Math.ceil(longer.length * 1.2) + 40;
    const floor = Math.floor(shorter.length * 0.5);
    if (!merged || merged.length > limit || merged.length < floor) {
      console.log(`[library] 「${name}」融合结果不可靠(输出 ${merged.length} 字, 期望 ${floor}~${limit}), 降级取更全原文`);
      return longer;
    }
    return merged;
  } catch {
    return longer;
  }
}

/** 身份/标签去重(去空白 + 去重, 保序) */
export function uniqTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
}

export interface LibraryRecordInput {
  name: string;
  identity?: string[];
  prompt?: string;
  image_ids?: number[];
}

export interface UpsertResult {
  id: number;
  /** true = 命中已有记录并合并身份 */
  merged: boolean;
  /** 合并后的身份标签 */
  identity: string[];
}

/**
 * 去重写入: content_key 已存在 → 合并身份(并集去重)后返回已有 id;
 * 不存在 → 新建。供 剧本解析 与 三库 POST 共用。
 */
export async function upsertLibraryRecord(table: LibraryTable, input: LibraryRecordInput): Promise<UpsertResult> {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("名称不能为空");
  // 同名写入串行化: AI 融合期间不允许另一个同名请求插入重复记录
  return withNameLock(`${table}|${normName(name)}`, async () => {
    const prompt = String(input.prompt || "").trim();
    const newTags = uniqTags(input.identity || []);
    const nkey = normName(name);
    const db: Database = await getDb();
    const now = new Date().toISOString();

    // 实质同名(名称归一化一致, 容错空格/标点/全半角/大小写等细微差异) → 同一条记录:
    // 合并身份与图片; 提示词不同则融合(而非直接覆盖)
    const same = queryOne(db, `SELECT id, identity, prompt, image_ids FROM ${table} WHERE name_key=? ORDER BY id LIMIT 1`, [nkey]);
    if (same) {
      let oldTags: string[] = [];
      let oldImgs: number[] = [];
      try { oldTags = JSON.parse(String(same.identity || "[]")) as string[]; } catch { /* ignore */ }
      try { oldImgs = JSON.parse(String(same.image_ids || "[]")) as number[]; } catch { /* ignore */ }
      const merged = uniqTags([...oldTags, ...newTags]);
      const mergedImgs = [...new Set([...oldImgs, ...(input.image_ids || [])])];
      const finalPrompt = await mergePrompts(name, String(same.prompt || ""), prompt);
      // 图片是并集累积(同名=同一对象, 多角度参考图都要留)。累积过多时给一条可见日志:
      // 生成时会按模型上限「均衡取用」, 不至于报错, 但值得让使用者知道
      if (mergedImgs.length > 12) {
        console.log(`[library] 「${name}」图片已累积到 ${mergedImgs.length} 张, 生成时按模型上限均衡取用`);
      }
      db.run(
        `UPDATE ${table} SET identity=?, prompt=?, image_ids=?, content_key=?, name_key=?, updated_at=? WHERE id=?`,
        [JSON.stringify(merged), finalPrompt, JSON.stringify(mergedImgs), contentKey(name, finalPrompt), nkey, now, Number(same.id)],
      );
      await persist();
      return { id: Number(same.id), merged: true, identity: merged };
    }

    db.run(
      `INSERT INTO ${table}(name, identity, prompt, image_ids, content_key, name_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`,
      [name, JSON.stringify(newTags), prompt, JSON.stringify(input.image_ids || []), contentKey(name, prompt), nkey, now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    await persist();
    return { id, merged: false, identity: newTags };
  });
}

/** JSON 数组安全解析(number[]) */
function parseNumArr(raw: unknown): number[] {
  try {
    const a = JSON.parse(String(raw || "[]")) as unknown[];
    return a.filter((n): n is number => typeof n === "number");
  } catch { return []; }
}

/** 三库列表项(含解析后的标签/图片明细) */
export interface LibraryListItem {
  id: number;
  name: string;
  identity: string[];
  prompt: string;
  image_ids: number[];
  images: { id: number; path: string; name: string; description: string }[];
  created_at: string;
  updated_at: string;
}

/**
 * 三库列表查询(三个 /api 共用):
 * - keyword: 名称模糊 + 分页(列表展示)
 * - ids / nameKeys: 精确批量定位(剧本联动用 —— 库内同名记录已合并, 按名称归一化键匹配最可靠)
 */
export async function listLibraryRecords(
  table: LibraryTable,
  opts: { keyword?: string; page?: number; pageSize?: number; ids?: number[]; nameKeys?: string[] } = {},
): Promise<{ items: LibraryListItem[]; total: number }> {
  const db: Database = await getDb();
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize || 10));
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.keyword) { where.push("name LIKE ?"); params.push(`%${opts.keyword}%`); }
  if (opts.ids?.length) { where.push(`id IN (${opts.ids.map(() => "?").join(",")})`); params.push(...opts.ids); }
  if (opts.nameKeys?.length) { where.push(`name_key IN (${opts.nameKeys.map(() => "?").join(",")})`); params.push(...opts.nameKeys); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = Number(queryOne(db, `SELECT COUNT(*) AS n FROM ${table} ${whereSql}`, params)?.n ?? 0);
  const rows = queryAll(
    db,
    `SELECT * FROM ${table} ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  // 解析 JSON 字段 + 关联图片明细
  const imageIds = new Set<number>();
  const items = rows.map((r) => {
    let identity: string[] = [];
    try { identity = JSON.parse(String(r.identity || "[]")) as string[]; } catch { /* ignore */ }
    const ids = parseNumArr(r.image_ids);
    ids.forEach((n) => imageIds.add(n));
    return {
      id: Number(r.id),
      name: String(r.name || ""),
      identity,
      prompt: String(r.prompt || ""),
      image_ids: ids,
      images: [] as LibraryListItem["images"],
      created_at: String(r.created_at || ""),
      updated_at: String(r.updated_at || ""),
    };
  });
  if (imageIds.size) {
    const imgs = queryAll(
      db,
      `SELECT id, path, name, description FROM images WHERE id IN (${[...imageIds].map(() => "?").join(",")})`,
      [...imageIds],
    );
    const imgMap = new Map(imgs.map((i) => [Number(i.id), i]));
    for (const it of items) {
      it.images = it.image_ids
        .map((n) => imgMap.get(n))
        .filter((x): x is Record<string, unknown> => !!x)
        .map((x) => ({ id: Number(x.id), path: String(x.path || ""), name: String(x.name || ""), description: String(x.description || "") }));
    }
  }
  return { items, total };
}

/**
 * 历史重复清理: 同表内名称归一化一致的记录合并为一条
 * (身份/图片并集去重, 提示词逐条融合, 剧本引用指向保留的记录, 多余记录删除)
 */
export async function dedupeLibrary(table: LibraryTable): Promise<{ groups: number; removed: number; details: string[] }> {
  const db: Database = await getDb();
  const rows = queryAll(db, `SELECT id, name, name_key, identity, prompt, image_ids FROM ${table} ORDER BY id`);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = String(r.name_key || normName(String(r.name)));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const details: string[] = [];
  let groupCount = 0;
  let removed = 0;
  const idMap = new Map<number, number>(); // 被删 id → 保留 id

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keep = list[0];
    const keepId = Number(keep.id);
    let tags: string[] = [];
    let imgs: number[] = [];
    let prompt = String(keep.prompt || "").trim();
    for (const r of list) {
      try { tags = uniqTags([...tags, ...(JSON.parse(String(r.identity || "[]")) as string[])]); } catch { /* ignore */ }
      imgs = [...new Set([...imgs, ...parseNumArr(r.image_ids)])];
      const p = String(r.prompt || "").trim();
      if (p && p !== prompt) prompt = await mergePrompts(String(keep.name), prompt, p);
    }
    const name = String(keep.name);
    db.run(
      `UPDATE ${table} SET identity=?, prompt=?, image_ids=?, content_key=?, name_key=?, updated_at=? WHERE id=?`,
      [JSON.stringify(tags), prompt, JSON.stringify(imgs), contentKey(name, prompt), normName(name), new Date().toISOString(), keepId],
    );
    for (const r of list.slice(1)) {
      const rid = Number(r.id);
      idMap.set(rid, keepId);
      db.run(`DELETE FROM ${table} WHERE id=?`, [rid]);
      removed++;
    }
    groupCount++;
    details.push(`${name}: ${list.length} 条 → 1 条`);
  }

  // 剧本里对这些 id 的引用改指向保留的记录
  if (idMap.size) {
    const scripts = queryAll(db, "SELECT id, character_ids, scene_ids, product_ids FROM scripts");
    for (const s of scripts) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const col of ["character_ids", "scene_ids", "product_ids"] as const) {
        const ids = parseNumArr(s[col]);
        const mapped = [...new Set(ids.map((n) => idMap.get(n) ?? n))];
        if (JSON.stringify(mapped) !== JSON.stringify(ids)) {
          sets.push(`${col}=?`);
          vals.push(JSON.stringify(mapped));
        }
      }
      if (sets.length) {
        sets.push("materials_fp=?"); // 物料变了, 下次生成重新做一致性检查
        vals.push("");
        db.run(`UPDATE scripts SET ${sets.join(",")} WHERE id=?`, [...vals, Number(s.id)]);
      }
    }
  }

  await persist();
  return { groups: groupCount, removed, details };
}