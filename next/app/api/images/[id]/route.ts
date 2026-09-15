// 图片: DELETE /api/images/[id] 删除记录(文件保留, 避免误删引用)
import type { NextRequest } from "next/server";
import { getDb, persist } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  db.run("DELETE FROM images WHERE id=?", [nid]);
  await persist();
  return Response.json({ ok: true });
}