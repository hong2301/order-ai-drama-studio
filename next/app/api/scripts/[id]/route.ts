// 剧本: PUT /api/scripts/[id] 部分更新(提示词/名称/物料关联/生成参数) | DELETE 删除单个
import type { NextRequest } from "next/server";
import { getDb, queryOne, persist, guessScriptName } from "@/lib/server/db";

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED_COLS = ["name", "file_path", "content", "character_ids", "scene_ids", "product_ids", "resolution", "duration", "ratio"] as const;

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }

  const db = await getDb();
  if (!queryOne(db, "SELECT id, name, content FROM scripts WHERE id=?", [nid])) {
    return Response.json({ detail: "剧本不存在" }, { status: 404 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const col of ALLOWED_COLS) {
    if (b[col] === undefined) continue;
    let v: unknown = b[col];
    // 数组字段(物料关联)序列化存储
    if (col === "character_ids" || col === "scene_ids" || col === "product_ids") {
      v = Array.isArray(v) ? JSON.stringify(v.map(Number).filter((n: unknown) => Number.isInteger(n))) : JSON.stringify([]);
    } else {
      v = String(v ?? "");
    }
    sets.push(`${col}=?`);
    vals.push(v);
  }
  // name 为空时回退到 content 首行; content 未提交则不动 name, 需要原始 content
  if (sets.includes("name=") && !String(b.name ?? "").trim()) {
    const row = queryOne(db, "SELECT name, content FROM scripts WHERE id=?", [nid]);
    const src = typeof b.content === "string" && b.content.trim() ? b.content : String(row?.content || "");
    const fallback = guessScriptName(src);
    vals[0] = fallback;
  }
  if (!sets.length) return Response.json({ detail: "没有可更新的字段" }, { status: 400 });

  sets.push("updated_at=?");
  vals.push(new Date().toISOString());
  db.run(`UPDATE scripts SET ${sets.join(",")} WHERE id=?`, [...vals, nid]);
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