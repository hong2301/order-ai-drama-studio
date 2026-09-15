// 剧本解析: POST /api/scripts/[id]/parse — 手动触发(右键"解析")
// 识别 人物/场景/产品→三库查重写入并关联; 记录清晰度/时长/比例/关键词
import type { NextRequest } from "next/server";
import { parseScript } from "@/lib/server/scriptParse";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const nid = Number(id);
  if (!Number.isInteger(nid)) return Response.json({ detail: "非法 id" }, { status: 400 });
  const r = await parseScript(nid);
  if (!r.ok) return Response.json({ detail: r.detail || "解析失败" }, { status: 422 });
  return Response.json({ ok: true, summary: r.summary });
}