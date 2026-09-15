// 视频任务列表: GET /api/video/tasks
import { listVideoTasks, ensureVideoTables } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await ensureVideoTables();
    const tasks = await listVideoTasks(50);
    return Response.json({ ok: true, tasks });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}