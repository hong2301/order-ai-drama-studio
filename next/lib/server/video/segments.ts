// 长剧本分段: 模型单次最长 15 秒, 所以按分镜顺序累加时长, 凑到上限就切成一段
// 一个「段」= 连续几个分镜, 提交一次生成(段内分镜的提示词按时间顺序合并)
import { getDb, queryAll, persist } from "@/lib/server/db";
import { getModelDef } from "./registry";

/** 分段结果: 每段包含哪些分镜(按 seq 升序) */
export interface ShotSeg {
  id: number;
  seq: number;
  /** 所属段号(0=未分段) */
  segment: number;
  time_range: string;
  duration: number;
  prompt: string;
  note: string;
}

export interface Segment {
  /** 段号(从 1 开始) */
  index: number;
  shots: ShotSeg[];
  /** 段总时长(秒) */
  duration: number;
  /** 合并后的提示词 */
  prompt: string;
}

/** 缺省段上限(秒) —— 跟随模型的 presets.durationMax; 拿不到时按豆包 Seedance 常见上限 15 */
export const SEGMENT_MAX_SEC = 15;

/** 取某模型的「单次生成时长上限」——分段就按它切(模型写明的为准, 否则回退 15) */
export function segMaxFor(modelKey?: string): number {
  const d = modelKey ? getModelDef(modelKey) : undefined;
  const m = Number(d?.presets?.durationMax || 0);
  return m > 0 ? Math.min(m, 60) : SEGMENT_MAX_SEC;
}

function rowToShot(r: Record<string, unknown>): ShotSeg {
  return {
    id: Number(r.id),
    seq: Number(r.seq || 0),
    segment: Number(r.segment || 0),
    time_range: String(r.time_range || ""),
    duration: Number(r.duration || 0) || 4,   // 没填时按 4 秒估
    prompt: String(r.prompt || ""),
    note: String(r.note || ""),
  };
}

/**
 * 把一个剧本的分镜切成若干段: 顺序累加时长, 达到上限(或单个分镜本身就超上限)就收一段。
 * 例(上限15): 4+4+5=13 → 第1段;  6+5=11 → 第2段;  4... → 第3段
 */
export function partitionSegments(shots: ShotSeg[], maxSec = SEGMENT_MAX_SEC): Segment[] {
  const segs: Segment[] = [];
  let cur: ShotSeg[] = [];
  let curDur = 0;
  const flush = (): void => {
    if (!cur.length) return;
    segs.push({ index: segs.length + 1, shots: cur, duration: curDur, prompt: buildSegmentPrompt(segs.length + 1, cur, curDur) });
    cur = [];
    curDur = 0;
  };
  for (const s of shots) {
    // 单个分镜就超过上限: 自己独占一段(提交时由 provider 按接口上限自动下调)
    if (s.duration >= maxSec) {
      flush();
      cur = [s]; curDur = s.duration; flush();
      continue;
    }
    if (curDur + s.duration > maxSec) flush();
    cur.push(s);
    curDur += s.duration;
  }
  flush();
  return segs;
}

/** 段内多个分镜 → 一段连续提示词(模型在一个视频里按顺序演完这几个镜头) */
export function buildSegmentPrompt(index: number, shots: ShotSeg[], totalSec: number): string {
  if (shots.length === 1) {
    return `${shots[0].prompt}\n\n【本段】共约 ${totalSec} 秒。`;
  }
  const lines = shots.map((s, i) => {
    const from = shots.slice(0, i).reduce((n, x) => n + x.duration, 0);
    const to = from + s.duration;
    const mark = s.time_range ? `${s.time_range} / ${from}-${to}秒` : `${from}-${to}秒`;
    return `（${mark}）${s.prompt}${s.note ? `｜${s.note}` : ""}`;
  });
  return [
    `【第 ${index} 段 · 约 ${totalSec} 秒 · 连续镜头】按下面的顺序依次演完，保持同一人物造型与场景连贯，镜头自然衔接：`,
    ...lines,
  ].join("\n");
}

/** 读剧本的分镜(按 seq) */
export async function loadShots(scriptId: number): Promise<ShotSeg[]> {
  const db = await getDb();
  const rows = queryAll(db, "SELECT * FROM storyboards WHERE script_id=? ORDER BY seq ASC, id ASC", [scriptId]);
  return rows.map(rowToShot);
}

/** 分段并把段号写回 storyboards.segment(生成前调用, 界面按段同步状态) */
export async function planSegments(scriptId: number, maxSec = SEGMENT_MAX_SEC): Promise<Segment[]> {
  const shots = await loadShots(scriptId);
  const segs = partitionSegments(shots, maxSec);
  const db = await getDb();
  const now = new Date().toISOString();
  for (const seg of segs) {
    for (const s of seg.shots) {
      db.run("UPDATE storyboards SET segment=?, updated_at=? WHERE id=?", [seg.index, now, s.id]);
    }
  }
  await persist();
  return segs;
}

/** 取剧本当前的段(按 segment 分组; 只含已分段的) */
export async function loadSegments(scriptId: number): Promise<Segment[]> {
  const shots = await loadShots(scriptId);
  const bySeg = new Map<number, ShotSeg[]>();
  for (const s of shots) {
    if (!s.segment) continue;
    if (!bySeg.has(s.segment)) bySeg.set(s.segment, []);
    bySeg.get(s.segment)!.push(s);
  }
  return [...bySeg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, list]) => {
      const dur = list.reduce((n, x) => n + x.duration, 0);
      return { index, shots: list, duration: dur, prompt: buildSegmentPrompt(index, list, dur) };
    });
}
