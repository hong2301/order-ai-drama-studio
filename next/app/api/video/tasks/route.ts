// 视频任务列表: GET /api/video/tasks?limit=N
import type { NextRequest } from "next/server";
import { listVideoTasks, ensureVideoTables } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await ensureVideoTables();
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 20)));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || 0));
    const tasks = await listVideoTasks(limit, offset);
    return Response.json({ ok: true, tasks });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}