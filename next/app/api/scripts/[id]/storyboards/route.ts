// 剧本的详细分镜: GET /api/scripts/[id]/storyboards
// 返回该剧本解析出的连续分镜(按 seq 排序): 时间段 | 提示词 | 媒体形式 | 媒体地址 | 备注
// 顺带推进长剧本分段任务的状态 —— 否则分镜会一直卡在「处理中」(没人去轮询段任务)
import { getDb, queryAll } from "@/lib/server/db";
import { refreshVideoTask, syncSegmentToStoryboard, TABLE } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const sid = Number(id);
  if (!Number.isInteger(sid) || sid <= 0) return Response.json({ detail: "非法 id" }, { status: 400 });
  try {
    const db = await getDb();
    // 推进/回写该剧本的分段任务:
    //  - 还没结束的 → refresh(拉方舟最新状态, 终态时内部会回写)
    //  - 已经终态的 → 直接回写分镜(幂等) —— 兵底: 之前没人轮询时任务已完成但分镜没同步
    const segTasks = queryAll(
      db,
      `SELECT id, segment, status, error, video_url FROM ${TABLE} WHERE script_id=? AND segment>0`,
      [sid],
    );
    for (const t of segTasks) {
      const st = String(t.status || "");
      try {
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          await syncSegmentToStoryboard(st, t.error ? String(t.error) : null, t.video_url ? String(t.video_url) : null, sid, Number(t.segment || 0));
        } else {
          await refreshVideoTask(String(t.id));
        }
      } catch { /* 单个失败不影响列表 */ }
    }
    const rows = queryAll(db, "SELECT * FROM storyboards WHERE script_id=? ORDER BY seq ASC, id ASC", [sid]);
    const items = rows.map((r) => ({
      id: Number(r.id),
      script_id: Number(r.script_id),
      seq: Number(r.seq || 0),
      time_range: String(r.time_range || ""),
      duration: Number(r.duration || 0),
      prompt: String(r.prompt || ""),
      media_type: String(r.media_type || ""),
      media_url: String(r.media_url || ""),
      note: String(r.note || ""),
      segment: Number(r.segment || 0),
      // 长剧本分段生成的状态: idle=未生成 / running=处理中(黄) / succeeded=完成 / failed=失败(红)
      status: String(r.status || "idle"),
      video_url: String(r.video_url || ""),
      error: String(r.error || ""),
    }));
    return Response.json({ ok: true, items, total: items.length });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}
