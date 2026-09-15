// 剧本: PUT /api/scripts/[id] 更新 | DELETE 删除单个
import type { NextRequest } from "next/server";
import { getDb, queryOne, persist } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };
type Body = { name?: string; file_path?: string; content?: string };

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
  const filePath = (b.file_path || "").trim();
  const content = b.content || "";
  if (!name && !content) return Response.json({ detail: "名称或内容不能为空" }, { status: 400 });
  const finalName = name || content.split(/\r?\n/)[0].trim().slice(0, 30) || "未命名";
  const db = await getDb();
  if (!queryOne(db, "SELECT id FROM scripts WHERE id=?", [nid])) {
    return Response.json({ detail: "剧本不存在" }, { status: 404 });
  }
  db.run("UPDATE scripts SET name=?, file_path=?, content=?, updated_at=? WHERE id=?", [finalName, filePath, content, new Date().toISOString(), nid]);
  await persist();
  return Response.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  db.run("DELETE FROM scripts WHERE id=?", [nid]);
  await persist();
  return Response.json({ ok: true });
}