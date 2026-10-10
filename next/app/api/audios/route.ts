// 音频: GET /api/audios 列表 | POST 新增记录(已上传文件登记的补充入口)
import type { NextRequest } from "next/server";
import { getDb, queryAll, persist } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const db = await getDb();
    const rows = queryAll(db, "SELECT * FROM audios ORDER BY id DESC");
    const items = rows.map((r) => ({
      id: Number(r.id),
      path: String(r.path || ""),
      name: String(r.name || ""),
      description: String(r.description || ""),
    }));
    return Response.json({ ok: true, items, total: items.length });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: { path?: string; name?: string; description?: string } = {};
  try { b = (await req.json()) as typeof b; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const p = String(b.path || "").trim();
  if (!p) return Response.json({ detail: "缺少 path" }, { status: 400 });
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    "INSERT INTO audios(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
    [p, String(b.name || "音色").trim(), String(b.description || "").trim(), now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id });
}
