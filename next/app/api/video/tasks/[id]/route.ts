// 视频任务: GET 刷新 / DELETE 删除(含本地视频文件)
import { refreshVideoTask, deleteVideoTask } from "@/lib/server/video";

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

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const ok = await deleteVideoTask(id);
    if (!ok) return Response.json({ ok: false, detail: "任务不存在" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}