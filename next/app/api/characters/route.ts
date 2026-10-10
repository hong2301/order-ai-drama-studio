// characters: GET /api/characters 列表(名称筛选/分页; names/ids 批量定位供剧本联动) | POST 新增
import type { NextRequest } from "next/server";
import { normName } from "@/lib/server/db";
import { listLibraryRecords, upsertLibraryRecord } from "@/lib/server/library";

type Body = { name?: string; identity?: string[]; prompt?: string; image_ids?: number[]; audio_ids?: number[] };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "";
  // 剧本联动定位: 库内同名记录已合并, 按名称归一化键匹配最可靠(ids 作为兼底)
  const names = (url.searchParams.get("names") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = (url.searchParams.get("ids") || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") || 10)));
  const link = names.length > 0 || ids.length > 0;
  const r = await listLibraryRecords("characters", {
    keyword: name,
    ids,
    nameKeys: names.map(normName),
    page: link ? 1 : page,
    pageSize: link ? 200 : pageSize,
  });
  return Response.json(r);
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
    audio_ids: b.audio_ids,   // 音色参考音频(仅人物库)
  });
  return Response.json({ ok: true, id: r.id, merged: r.merged });
}
