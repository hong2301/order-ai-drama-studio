// AI 模型配置: 更新/删除
import type { NextRequest } from "next/server";
import { updateConfig, deleteConfig } from "@/lib/server/ai";
import { jsonError } from "@/lib/server/http";

type Ctx = { params: Promise<{ cid: string }> };

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  try {
    const { cid } = await ctx.params;
    const cfg = await updateConfig(Number(cid), (await req.json()) as Record<string, unknown>);
    if (!cfg) return jsonError(404, "配置不存在");
    return Response.json(cfg);
  } catch (e) { return jsonError(500, (e as Error).message); }
}
export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  try {
    const { cid } = await ctx.params;
    if (!(await deleteConfig(Number(cid)))) return jsonError(404, "配置不存在");
    return Response.json({ ok: true });
  } catch (e) { return jsonError(500, (e as Error).message); }
}
