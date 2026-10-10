// 长剧本分段生成: POST /api/scripts/[id]/generate
// body: { modelKey, resolution?, ratio?, imageUrl? }
//
// 模型单次最长 15 秒 → 按分镜时长分段(几个分镜合一段), 逐段提交生成;
// 段状态回写 storyboards.status(界面直接显示黄/红/默认)。提交放后台, 接口秒回。
import type { NextRequest } from "next/server";
import { getDb, persist, queryAll, queryOne } from "@/lib/server/db";
import { createVideoTask, ensureVideoTables, refreshVideoTask } from "@/lib/server/video";
import type { VideoTask } from "@/lib/server/video/types";
import { getModelDef } from "@/lib/server/video/registry";
import { loadScriptMaterials, pickReferenceImages, pickReferenceAudios, buildMaterialsBlock, type RefImage } from "@/lib/server/video/materials";
import { extractLastFrame } from "@/lib/server/video/frames";
import { planSegments, segMaxFor } from "@/lib/server/video/segments";

export const dynamic = "force-dynamic";

type Body = { modelKey?: string; resolution?: string; ratio?: string; imageUrl?: string | null; segment?: number };

/** 清空分镜的生成结果(状态/成片/错误) —— 重新生成前调用, 否则会残留上一次的“已完成”看起来像秒生成 */
async function clearSegmentResults(scriptId: number, only: number): Promise<void> {
  try {
    const db = await getDb();
    db.run(
      `UPDATE storyboards SET status='idle', video_url='', error='', media_url='', updated_at=? WHERE script_id=?${only > 0 ? " AND segment=" + only : ""}`,
      [new Date().toISOString(), scriptId],
    );
    await persist();
  } catch { /* ignore */ }
}

/** 把某段的所有分镜标成同一状态(界面按段同步显示) */
async function markSegment(scriptId: number, segment: number, status: string, error = ""): Promise<void> {
  try {
    const db = await getDb();
    db.run(
      "UPDATE storyboards SET status=?, error=?, updated_at=? WHERE script_id=? AND segment=?",
      [status, error, new Date().toISOString(), scriptId, segment],
    );
    await persist();
  } catch { /* ignore */ }
}

/** 等一个任务到终态(串行链用): 每 8 秒拉一次, 超时返回 null */
async function waitVideoTask(id: string, timeoutMs = 15 * 60 * 1000): Promise<VideoTask | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const t = await refreshVideoTask(id);
      if (t && (t.status === "succeeded" || t.status === "failed" || t.status === "cancelled")) return t;
    } catch { /* 忽略单次失败, 下一轮再试 */ }
  }
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const sid = Number(id);
  if (!Number.isInteger(sid) || sid <= 0) return Response.json({ ok: false, detail: "非法 id" }, { status: 400 });

  let b: Body = {};
  try { b = (await req.json()) as Body; } catch { /* ignore */ }
  const modelKey = String(b.modelKey || "").trim();
  if (!modelKey) return Response.json({ ok: false, detail: "缺少 modelKey" }, { status: 400 });

  try {
    await ensureVideoTables();
    const db = await getDb();
    const script = queryOne(db, "SELECT name, kind FROM scripts WHERE id=?", [sid]);
    if (!script) return Response.json({ ok: false, detail: "剧本不存在" }, { status: 404 });
    const scriptName = String(script.name || "");

    // 分段: 段上限跟随所选模型(如 2.0 Mini=15 秒, 2.5=30 秒), 段号写回 storyboards.segment
    const maxSec = segMaxFor(modelKey);
    const all = await planSegments(sid, maxSec);
    if (!all.length) return Response.json({ ok: false, detail: "还没有分镜，请先解析剧本" }, { status: 400 });
    // segment 给了就只重跑那一段(右键「重新处理」)
    const only = Number(b.segment || 0);
    const segs = only > 0 ? all.filter((s) => s.index === only) : all;
    if (!segs.length) return Response.json({ ok: false, detail: `没有第 ${only} 段` }, { status: 400 });

    // 物料注入: 分镜 prompt 只写剧情, 人物长相/场景/产品外观要从资料库补进来
    // (参考图 + 文字块一起给, 与短剧本链路同一套) —— 否则每段生成出来的形象对不上
    const mats = await loadScriptMaterials(sid);
    const maxRef = getModelDef(modelKey)?.presets?.maxReferenceImages || 0;
    const refs = maxRef > 0 ? pickReferenceImages(mats, maxRef) : [];
    const audioRefs = pickReferenceAudios(mats);   // 人物库挂的音色参考(如「正常说话」)
    const materialsBlock = buildMaterialsBlock(mats, refs);
    console.log(`[long] 剧本${sid}: 物料 ${mats.length} 项, 参考图 ${refs.length} 张(上限 ${maxRef || "不支持"}), 音色音频 ${audioRefs.length} 条`);

    // 防重复: 该剧本已有段在生成中时, 不再启动新的串行链(否则连点会并存多条链)
    const busy = queryAll(db, "SELECT 1 AS x FROM storyboards WHERE script_id=? AND status='running' LIMIT 1", [sid]);
    if (busy.length) {
      return Response.json({ ok: false, detail: "该剧本还有分镜在生成中，请等它跑完（或右键单段重新生成）" }, { status: 400 });
    }

    // 重新生成前先清掉旧结果(状态与成片) —— 否则旧成片会残留, 看起来像“一点就秒生成好了”
    await clearSegmentResults(sid, only);

    // 串行链: 一段完成才提交下一段 —— 每段拿上一段的**末帧**当参考图并在提示词里指定为本段首帧,
    // 这样 20 段能接成一条连贯的片子(不靠模型跨请求的“上下文”, 那是没有的)。
    // 全部用 role=reference_image: 方舟规定首帧图与参考图互斥, 官方给的间接做法就是“参考图 + 提示词指定”。
    void (async () => {
      let prevFrame: RefImage | null = null;   // 上一段末帧
      for (const seg of segs) {
        await markSegment(sid, seg.index, "running");
        try {
          const segRefs: RefImage[] = [...refs];
          if (prevFrame) segRefs.push(prevFrame);
          const hint = prevFrame
            ? `\n\n【镜头衔接】以 @图像${segRefs.length}（上一段的结尾画面）作为本段的**起始画面**，人物长相与服装、场景陈设与光线、产品外观都要与它完全连贯，不要跳变或换人。`
            : "";
          const task = await createVideoTask({
            modelKey,
            // 段提示词 + 物料块(每段都要带, 否则各段的形象会对不上) + 衔接说明
            prompt: `${seg.prompt}${materialsBlock}${hint}`,
            referenceImages: segRefs,
            referenceAudios: audioRefs,   // 音色参考(人物库的音频)
            resolution: b.resolution || undefined,
            ratio: b.ratio || undefined,
            duration: seg.duration,
            kind: "long",
            segment: seg.index,          // 视频库/回写分镜靠它定位
            scriptId: sid,
            scriptName,
            imageUrl: b.imageUrl || null,
          });
          console.log(`[long] 第 ${seg.index} 段已提交(${seg.shots.length} 个分镜 / ${seg.duration}s / 参考图 ${segRefs.length} 张${prevFrame ? ", 含上段末帧" : ""})`);

          // 等这一段出片 → 抽末帧给下一段用
          const done = await waitVideoTask(task.id);
          if (done?.status === "succeeded" && done.videoUrl) {
            const frame = await extractLastFrame(done.videoUrl, `第${seg.index}段末帧`);
            if (frame) {
              prevFrame = { url: frame, name: "上一段结尾画面", kind: "衔接", material: "上一段结尾画面" };
              console.log(`[long] 第 ${seg.index} 段末帧已抽出, 将作为第 ${seg.index + 1} 段首帧`);
            }
          } else if (done && done.status !== "succeeded") {
            // 失败: 本段标红, 不阻断后续(下一段没末帧就不衔接)
            await markSegment(sid, seg.index, "failed", (done.error || "生成失败").slice(0, 200));
            prevFrame = null;
          }
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[long] 第 ${seg.index} 段失败: ${msg}`);
          await markSegment(sid, seg.index, "failed", msg.slice(0, 200));
          prevFrame = null;
        }
      }
      console.log(`[long] 剧本${sid} 全部 ${segs.length} 段处理完成`);
    })();

    return Response.json({
      ok: true,
      segments: segs.length,
      totalDuration: segs.reduce((n, s) => n + s.duration, 0),
      segmentMaxSec: maxSec,
      detail: only > 0 ? `已重新提交第 ${only} 段` : `已按 ${segs.length} 段提交生成(每段 ≤${maxSec} 秒)`,
    });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 400 });
  }
}
