// 图片: GET /api/images 列表 | POST /api/images 手动登记(path/name/description)
import type { NextRequest } from "next/server";
import { getDb, queryAll, persist } from "@/lib/server/db";

type Body = { path?: string; name?: string; description?: string };

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = await getDb();
  const rows = queryAll(db, "SELECT id, path, name, description, created_at FROM images ORDER BY id DESC");
  return Response.json(rows);
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const p = (b.path || "").trim();
  if (!p) return Response.json({ detail: "图片路径不能为空" }, { status: 400 });
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
    [p, (b.name || "").trim(), (b.description || "").trim(), now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id });
}