// 视频任务计数: GET /api/video/tasks/count → { pending }(生成中任务数, 含占位) —— 视频库入口徽标用
import { pendingVideoTaskCount, ensureVideoTables } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await ensureVideoTables();
    const pending = await pendingVideoTaskCount();
    return Response.json({ ok: true, pending });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}