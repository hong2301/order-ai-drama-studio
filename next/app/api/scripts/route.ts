// 剧本: GET /api/scripts 列表(名称模糊/创建日期范围/分页) | POST 新增(名称+内容, 名称可自动生成)
import type { NextRequest } from "next/server";
import { getDb, queryAll, queryOne, persist, guessScriptName } from "@/lib/server/db";

type Body = { name?: string; file_path?: string; content?: string };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "";
  const dateFrom = url.searchParams.get("date_from") || "";
  const dateTo = url.searchParams.get("date_to") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || 10)));
  const offset = (page - 1) * pageSize;

  // 动态条件: created_at 存 ISO 字符串, 前 10 位即 YYYY-MM-DD(字典序=时间序)
  const where: string[] = [];
  const params: unknown[] = [];
  if (name) { where.push("name LIKE ?"); params.push(`%${name}%`); }
  if (dateFrom) { where.push("substr(created_at,1,10) >= ?"); params.push(dateFrom); }
  if (dateTo) { where.push("substr(created_at,1,10) <= ?"); params.push(dateTo); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const db = await getDb();
  const total = Number(queryOne(db, `SELECT COUNT(*) AS n FROM scripts ${whereSql}`, params)?.n ?? 0);
  const rows = queryAll(
    db,
    `SELECT * FROM scripts ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  // 附带物料名称: 三库同名记录会被去重合并, 前端联动按「名称」选中比按 id 更可靠
  const idsOf = (raw: unknown): number[] => {
    try { return (JSON.parse(String(raw || "[]")) as unknown[]).filter((n): n is number => typeof n === "number"); } catch { return []; }
  };
  const idSets: Record<string, Set<number>> = { characters: new Set(), scenes: new Set(), products: new Set() };
  for (const r of rows) {
    idsOf(r.character_ids).forEach((n) => idSets.characters.add(n));
    idsOf(r.scene_ids).forEach((n) => idSets.scenes.add(n));
    idsOf(r.product_ids).forEach((n) => idSets.products.add(n));
  }
  const nameMap: Record<string, Map<number, string>> = {};
  for (const table of ["characters", "scenes", "products"] as const) {
    const m = new Map<number, string>();
    const ids = [...idSets[table]];
    if (ids.length) {
      const rs = queryAll(db, `SELECT id, name FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      for (const x of rs) m.set(Number(x.id), String(x.name || ""));
    }
    nameMap[table] = m;
  }
  const pickNames = (table: "characters" | "scenes" | "products", raw: unknown): string[] =>
    idsOf(raw).map((n) => nameMap[table].get(n)).filter((x): x is string => !!x);
  const items = rows.map((r) => ({
    ...r,
    char_names: pickNames("characters", r.character_ids),
    scene_names: pickNames("scenes", r.scene_ids),
    prod_names: pickNames("products", r.product_ids),
  }));
  return Response.json({ items, total });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const content = b.content || "";
  // 名称未填时从内容里猜一个可读的名字(跳过 Markdown 标记/表格行/字段名)
  const finalName = (b.name || "").trim() || guessScriptName(content);
  if (!finalName) return Response.json({ detail: "名称或内容不能为空" }, { status: 400 });
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    "INSERT INTO scripts(name, file_path, content, created_at, updated_at) VALUES(?,?,?,?,?)",
    [finalName, (b.file_path || "").trim(), content, now, now],
  );
  // last_insert_rowid 须在 persist(export) 前读取
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  // 自动解析(识别人物/场景/产品/清晰度/时长/关键词; 失败不影响添加)
  let parse = null;
  try {
    const { parseScript } = await import("@/lib/server/scriptParse");
    parse = await parseScript(id);
  } catch { /* ignore */ }
  return Response.json({ ok: true, id, parse });
}