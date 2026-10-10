// 视频任务计数: GET /api/video/tasks/count?kind=short|long → { pending }(生成中任务数, 含占位) —— 视频库入口徽标用
import type { NextRequest } from "next/server";
import { pendingVideoTaskCount, ensureVideoTables } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await ensureVideoTables();
    const kind = req.nextUrl.searchParams.get("kind") || undefined;
    const pending = await pendingVideoTaskCount(kind);
    return Response.json({ ok: true, pending });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}