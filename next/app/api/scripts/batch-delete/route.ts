// 剧本: POST /api/scripts/batch-delete 批量删除 {ids: number[]}
import type { NextRequest } from "next/server";
import { getDb, persist } from "@/lib/server/db";

type Body = { ids?: number[] };

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const ids = (b.ids || []).filter((n) => Number.isInteger(n));
  if (!ids.length) return Response.json({ detail: "未选择要删除的剧本" }, { status: 400 });
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.run(`DELETE FROM scripts WHERE id IN (${placeholders})`, ids);
  await persist();
  return Response.json({ ok: true, deleted: ids.length });
}