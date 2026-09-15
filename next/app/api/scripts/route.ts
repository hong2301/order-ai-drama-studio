// 剧本: GET /api/scripts 列表(支持名称模糊/创建日期范围/分页) | POST /api/scripts 新增
import type { NextRequest } from "next/server";
import { getDb, queryAll, queryOne, persist } from "@/lib/server/db";

type Body = { name?: string; file_path?: string };

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
    `SELECT id, name, file_path, created_at, updated_at FROM scripts ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  return Response.json({ items: rows, total });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const name = (b.name || "").trim();
  const filePath = (b.file_path || "").trim();
  if (!name) return Response.json({ detail: "名称不能为空" }, { status: 400 });
  const now = new Date().toISOString();
  const db = await getDb();
  db.run("INSERT INTO scripts(name, file_path, created_at, updated_at) VALUES(?,?,?,?)", [name, filePath, now, now]);
  // last_insert_rowid 须在 persist(export) 前读取
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id });
}