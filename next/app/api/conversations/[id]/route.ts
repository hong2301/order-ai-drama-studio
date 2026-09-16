// 对话会话: GET /api/conversations/[id] 详情(消息) | PUT 保存(标题/消息/时间) | DELETE 删除(含消息)
import type { NextRequest } from "next/server";
import { getDb, queryOne, persist } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

function parseImages(raw: unknown): string[] {
  try { return (JSON.parse(String(raw || "[]")) as unknown[]).filter((s): s is string => typeof s === "string"); } catch { return []; }
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  const con = queryOne(db, "SELECT id, title, created_at, updated_at FROM conversations WHERE id=?", [id]);
  if (!con) return Response.json({ ok: false, detail: "会话不存在" }, { status: 404 });
  const rows = db.exec("SELECT role, content, images FROM messages WHERE conv_id=? ORDER BY id ASC", [id])[0]?.values || [];
  const messages = rows.map((r) => ({ role: String(r[0]), content: String(r[1] || ""), images: parseImages(r[2]) }));
  return Response.json({
    ok: true,
    conversation: { id: Number(con.id), title: String(con.title || "新对话"), created_at: String(con.created_at || ""), updated_at: String(con.updated_at || "") },
    messages,
  });
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, detail: "非法 id" }, { status: 400 });
  let b: { title?: string; messages?: unknown[] } = {};
  try { b = (await req.json()) as typeof b; } catch { return Response.json({ ok: false, detail: "参数解析失败" }, { status: 400 }); }
  const now = new Date().toISOString();
  const db = await getDb();
  if (!queryOne(db, "SELECT id FROM conversations WHERE id=?", [id])) {
    return Response.json({ ok: false, detail: "会话不存在" }, { status: 404 });
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.title !== undefined) {
    sets.push("title=?"); vals.push(String(b.title).trim().slice(0, 60) || "新对话");
  }
  sets.push("updated_at=?"); vals.push(now);
  db.run(`UPDATE conversations SET ${sets.join(",")} WHERE id=?`, [...vals, id]);

  if (Array.isArray(b.messages)) {
    db.run("DELETE FROM messages WHERE conv_id=?", [id]);
    for (const m of b.messages) {
      const msg = m as { role?: string; content?: string; images?: string[] } | null;
      if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
      const images = Array.isArray(msg.images) ? (msg.images as unknown[]).filter((s): s is string => typeof s === "string") : [];
      db.run("INSERT INTO messages(conv_id, role, content, images, created_at) VALUES(?,?,?,?,?)",
        [id, msg.role, String(msg.content || ""), JSON.stringify(images), now]);
    }
  }
  await persist();
  return Response.json({ ok: true, id });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  db.run("DELETE FROM messages WHERE conv_id=?", [id]);
  db.run("DELETE FROM conversations WHERE id=?", [id]);
  await persist();
  return Response.json({ ok: true, id });
}