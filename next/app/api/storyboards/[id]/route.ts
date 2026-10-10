// 单条分镜: PUT /api/storyboards/[id] 部分更新(时间段/提示词/媒体形式/媒体地址/备注) | DELETE 删除
import type { NextRequest } from "next/server";
import { getDb, queryOne, persist } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };
type Body = { time_range?: string; duration?: number; prompt?: string; media_type?: string; media_url?: string; note?: string; seq?: number };

export const dynamic = "force-dynamic";

const COLS = ["time_range", "prompt", "media_type", "media_url", "note"] as const;

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid) || nid <= 0) return Response.json({ detail: "非法 id" }, { status: 400 });
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const db = await getDb();
  if (!queryOne(db, "SELECT id FROM storyboards WHERE id=?", [nid])) {
    return Response.json({ detail: "分镜不存在" }, { status: 404 });
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const c of COLS) {
    if (b[c] === undefined) continue;
    sets.push(`${c}=?`);
    vals.push(String(b[c] ?? "").trim());
  }
  if (b.duration !== undefined) {
    const d = Math.round(Number(b.duration));
    sets.push("duration=?");
    vals.push(Number.isFinite(d) && d > 0 ? d : 0);
  }
  if (b.seq !== undefined) { sets.push("seq=?"); vals.push(Number(b.seq) || 0); }
  if (!sets.length) return Response.json({ detail: "没有可更新的字段" }, { status: 400 });
  sets.push("updated_at=?");
  vals.push(new Date().toISOString());
  db.run(`UPDATE storyboards SET ${sets.join(",")} WHERE id=?`, [...vals, nid]);
  await persist();
  return Response.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid) || nid <= 0) return Response.json({ detail: "非法 id" }, { status: 400 });
  const db = await getDb();
  db.run("DELETE FROM storyboards WHERE id=?", [nid]);
  await persist();
  return Response.json({ ok: true });
}
