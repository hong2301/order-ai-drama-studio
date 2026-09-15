// 视频任务查询(自动拉取商家最新状态): GET /api/video/tasks/[id]
import { refreshVideoTask } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const task = await refreshVideoTask(id);
    if (!task) return Response.json({ ok: false, detail: "任务不存在" }, { status: 404 });
    return Response.json({ ok: true, task });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}