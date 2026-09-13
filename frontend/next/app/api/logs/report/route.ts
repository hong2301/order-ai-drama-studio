// 前端渲染进程崩溃现场上报 -> 日志(app.log, error 级别)
import type { NextRequest } from "next/server";
import { logger } from "@/lib/server/logger";

export async function POST(req: NextRequest): Promise<Response> {
  let payload: unknown = "?";
  try { payload = await req.json(); } catch { /* ignore */ }
  logger.error("前端上报: %s", JSON.stringify(payload).slice(0, 2000));
  return Response.json({ ok: true });
}
