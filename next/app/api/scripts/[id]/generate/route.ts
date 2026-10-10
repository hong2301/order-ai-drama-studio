// 长剧本分段生成: POST /api/scripts/[id]/generate
// body: { modelKey, resolution?, ratio?, imageUrl? }
//
// 模型单次最长 15 秒 → 按分镜时长分段(几个分镜合一段), 逐段提交生成;
// 段状态回写 storyboards.status(界面直接显示黄/红/默认)。提交放后台, 接口秒回。
import type { NextRequest } from "next/server";
import { getDb, persist, queryOne } from "@/lib/server/db";
import { createVideoTask, ensureVideoTables } from "@/lib/server/video";
import { getModelDef } from "@/lib/server/video/registry";
import { loadScriptMaterials, pickReferenceImages, buildMaterialsBlock } from "@/lib/server/video/materials";
import { planSegments, segMaxFor } from "@/lib/server/video/segments";

export const dynamic = "force-dynamic";

type Body = { modelKey?: string; resolution?: string; ratio?: string; imageUrl?: string | null; segment?: number };

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
    const materialsBlock = buildMaterialsBlock(mats, refs);
    console.log(`[long] 剧本${sid}: 物料 ${mats.length} 项, 参考图 ${refs.length} 张(上限 ${maxRef || "不支持"})`);

    // 提交放后台; 每段先标记为“提交中”, 真提交成功后保持处理中, 失败则标红
    // ⚠ 不能一次性把全部段都标成处理中 —— 那样界面会一下全变黄, 看不出实际进度
    void (async () => {
      for (const seg of segs) {
        await markSegment(sid, seg.index, "running");
        try {
          await createVideoTask({
            modelKey,
            // 段提示词 + 物料块: 每段都要带, 否则各段的人物/场景/产品形象会对不上
            prompt: `${seg.prompt}${materialsBlock}`,
            referenceImages: refs,
            resolution: b.resolution || undefined,
            ratio: b.ratio || undefined,
            duration: seg.duration,
            kind: "long",
            segment: seg.index,          // 视频库/回写分镜靠它定位
            scriptId: sid,
            scriptName,
            imageUrl: b.imageUrl || null,
          });
          console.log(`[long] 第 ${seg.index} 段已提交(${seg.shots.length} 个分镜 / ${seg.duration}s)`);
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[long] 第 ${seg.index} 段提交失败: ${msg}`);
          await markSegment(sid, seg.index, "failed", msg.slice(0, 200));
        }
      }
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
