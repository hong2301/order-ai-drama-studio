// 音频: PUT /api/audios/[id] 更新(name/description) | DELETE 删除记录(文件保留, 避免误删引用)
import type { NextRequest } from "next/server";
import { getDb, queryOne, persist } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };
type Body = { name?: string; description?: string };

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const db = await getDb();
  const exist = queryOne(db, "SELECT * FROM audios WHERE id=?", [nid]);
  if (!exist) return Response.json({ detail: "音频不存在" }, { status: 404 });
  const name = b.name !== undefined ? String(b.name).trim() || "音色" : String(exist.name || "");
  const description = b.description !== undefined ? String(b.description).trim() : String(exist.description || "");
  db.run("UPDATE audios SET name=?, description=?, updated_at=? WHERE id=?", [name, description, new Date().toISOString(), nid]);
  await persist();
  return Response.json({ ok: true, id: nid, name });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  db.run("DELETE FROM audios WHERE id=?", [nid]);
  await persist();
  return Response.json({ ok: true });
}
