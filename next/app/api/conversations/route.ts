// 对话: GET /api/conversations 列表 | POST /api/conversations 新建空会话
// 会话消息走 /api/conversations/[id](GET 详情 / PUT 保存 / DELETE 删除)
import type { NextRequest } from "next/server";
import { getDb, persist } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = await getDb();
  const rows = db.exec("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC")[0]?.values || [];
  const items = rows.map((r) => ({ id: Number(r[0]), title: String(r[1] || "新对话"), created_at: String(r[2] || ""), updated_at: String(r[3] || "") }));
  return Response.json({ ok: true, items });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: { title?: string } = {};
  try { b = (await req.json()) as typeof b; } catch { /* ignore */ }
  const now = new Date().toISOString();
  const title = String(b.title || "").trim().slice(0, 60) || "新对话";
  const db = await getDb();
  // 清理历史空会话(避免堆积; 空会话无保留价值, 如迁移/切换产生的)
  db.run("DELETE FROM conversations WHERE id NOT IN (SELECT DISTINCT conv_id FROM messages)");
  db.run("INSERT INTO conversations(title, created_at, updated_at) VALUES(?,?,?)", [title, now, now]);
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id, title });
}