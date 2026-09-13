// 生成记录: 详情 / 删除(删除同时清理本地视频文件)
import fs from "fs";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/http";
import * as genRepo from "@/lib/server/generations";

type Ctx = { params: Promise<{ gid: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  try {
    const { gid } = await ctx.params;
    const g = await genRepo.getGeneration(Number(gid));
    if (!g) return jsonError(404, "记录不存在");
    return Response.json(g);
  } catch (e) { return jsonError(500, (e as Error).message); }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  try {
    const { gid } = await ctx.params;
    const g = await genRepo.getGeneration(Number(gid));
    if (!g) return jsonError(404, "记录不存在");
    if (g.local_path && fs.existsSync(g.local_path)) {
      try { fs.unlinkSync(g.local_path); } catch { /* ignore */ }
    }
    await genRepo.deleteGeneration(Number(gid));
    return Response.json({ ok: true });
  } catch (e) { return jsonError(500, (e as Error).message); }
}