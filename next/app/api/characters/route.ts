// characters: GET /api/characters 列表(名称筛选/分页) | POST 新增
import type { NextRequest } from "next/server";
import { getDb, queryAll, queryOne } from "@/lib/server/db";
import { upsertLibraryRecord } from "@/lib/server/library";

type Body = { name?: string; identity?: string[]; prompt?: string; image_ids?: number[] };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || 10)));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: unknown[] = [];
  if (name) { where.push("name LIKE ?"); params.push(`%${name}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const db = await getDb();
  const total = Number(queryOne(db, `SELECT COUNT(*) AS n FROM characters ${whereSql}`, params)?.n ?? 0);
  const rows = queryAll(db, `SELECT * FROM characters ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);

  // 解析 JSON 数组 + 关联图片明细
  const imageIds = new Set<number>();
  const items = rows.map((r) => {
    let identity: string[] = [];
    let ids: number[] = [];
    try { identity = JSON.parse(String(r.identity || "[]")); } catch {}
    try { ids = JSON.parse(String(r.image_ids || "[]")); } catch {}
    ids.forEach((n) => imageIds.add(n));
    return { ...r, identity, image_ids: ids };
  });
  const imgs = imageIds.size
    ? queryAll(db, `SELECT id, path, name, description FROM images WHERE id IN (${[...imageIds].map(() => "?").join(",")})`, [...imageIds])
    : [];
  const imgMap = new Map(imgs.map((i) => [Number(i.id), i]));
  for (const it of items) (it as { images?: unknown[] }).images = (it.image_ids as number[]).map((n) => imgMap.get(n)).filter(Boolean);
  return Response.json({ items, total });
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch {
    return Response.json({ detail: "参数解析失败" }, { status: 400 });
  }
  const name = (b.name || "").trim();
  if (!name) return Response.json({ detail: "名称不能为空" }, { status: 400 });
  const r = await upsertLibraryRecord("characters", {
    name,
    identity: b.identity,
    prompt: b.prompt,
    image_ids: b.image_ids,
  });
  return Response.json({ ok: true, id: r.id, merged: r.merged });
}
