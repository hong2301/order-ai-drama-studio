// 剧本: GET /api/scripts 列表(名称模糊/创建日期范围/分页) | POST 新增(名称+内容, 名称可自动生成)
import type { NextRequest } from "next/server";
import { getDb, queryAll, queryOne, persist } from "@/lib/server/db";

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
  return Response.json({ items: rows, total });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const content = b.content || "";
  // 名称未填时从内容首行截取(自动命名)
  const finalName = (b.name || "").trim() || content.split(/\r?\n/)[0].trim().slice(0, 30) || "";
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