// 剧本: GET /api/scripts 列表 | POST /api/scripts 新增
import type { NextRequest } from "next/server";
import { getDb, queryAll, persist } from "@/lib/server/db";

type Body = { name?: string; file_path?: string };

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = await getDb();
  const rows = queryAll(db, "SELECT id, name, file_path, created_at, updated_at FROM scripts ORDER BY id DESC");
  return Response.json(rows);
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
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id });
}