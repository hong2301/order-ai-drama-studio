// scenes: PUT /api/scenes/[id] 更新 | DELETE 删除单个
import type { NextRequest } from "next/server";
import { getDb, queryOne, persist } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };
type Body = { name?: string; identity?: string[]; prompt?: string; image_ids?: number[] };

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const name = (b.name || "").trim();
  if (!name) return Response.json({ detail: "名称不能为空" }, { status: 400 });
  const db = await getDb();
  if (!queryOne(db, "SELECT id FROM scenes WHERE id=?", [nid])) {
    return Response.json({ detail: "记录不存在" }, { status: 404 });
  }
  db.run(
    "UPDATE scenes SET name=?, identity=?, prompt=?, image_ids=?, updated_at=? WHERE id=?",
    [name, JSON.stringify(b.identity || []), (b.prompt || "").trim(), JSON.stringify(b.image_ids || []), new Date().toISOString(), nid],
  );
  await persist();
  return Response.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  db.run("DELETE FROM scenes WHERE id=?", [nid]);
  await persist();
  return Response.json({ ok: true });
}
