// 视频生成: POST /api/video/generate
// body: {modelKey, prompt?, scriptId?, imageUrl?, resolution?, ratio?, duration?}
// 流程: 立即创建占位任务(视频库立即可见"生成中") → 后台异步做 一致性检查/剧情适配(调AI) → 提交方舟 →
//       成功用真实任务更新占位(id 替换), 失败标记占位 failed
import type { NextRequest } from "next/server";
import { getDb, persist, queryAll, queryOne } from "@/lib/server/db";
import { adaptPrompt, materialsFp } from "@/lib/server/video/adapt";
import { createVideoTask, createPlaceholderTask, ensureVideoTables, TABLE } from "@/lib/server/video";
import type { VideoTask } from "@/lib/server/video/types";

export const dynamic = "force-dynamic";

function parseIds(raw?: string): number[] {
  try {
    const a = JSON.parse(String(raw || "[]")) as unknown[];
    return a.filter((n): n is number => typeof n === "number");
  } catch { return []; }
}

function materialsOf(db: Awaited<ReturnType<typeof getDb>>, table: "characters" | "scenes" | "products", ids: number[]): { name: string; prompt: string }[] {
  if (!ids.length) return [];
  const rows = queryAll(db, `SELECT name, prompt FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  return rows.map((r) => ({ name: String(r.name || ""), prompt: String(r.prompt || "") }));
}

interface GenBody {
  modelKey?: string; prompt?: string; scriptId?: number | null;
  imageUrl?: string | null; resolution?: string; ratio?: string; duration?: number;
  scriptName?: string;
}

/** 生成硬性约束(补在提示词末尾, 不改剧本内容; 让视频模型严格贴剧本人设场景产品) */
const GENERATION_CONSTRAINTS = [
  "",
  "【生成硬性要求】",
  "1. 严格遵循以上剧本的剧情、分镜顺序、对白与情绪, 不得自行加戏或偏离。",
  "2. 人物/场景/产品必须按剧本设定画面呈现(外貌/服装/光线/包装), 不得替换、缺失或变样。",
  "3. 镜头角度正常自然(常规平视机位), 动作有起止、人物不要长期静止站桩。",
  "4. 对白用「人物台词：xxx」, 配合动作; 画面不出现字幕卡/文字。",
  "5. 画面比例与时长严格遵守(如9:16·15秒), 情绪克制、生活化、轻冲突温暖反转。",
].join("\n");

/** 后台: 一致性适配(有绑定剧本时) → 提交方舟 → 用真实任务替换占位; 失败将占位标记 failed */
async function runGenerate(b: GenBody, placeholderId: string): Promise<void> {
  try {
    await ensureVideoTables();
    let prompt = String(b.prompt || "");
    let scriptName = b.scriptName || "";

    // 一致性检查 + 剧情适配(仅当绑定了剧本时)
    const scriptId = Number(b.scriptId);
    if (Number.isInteger(scriptId) && scriptId > 0) {
      const db = await getDb();
      const row = queryOne(db, "SELECT * FROM scripts WHERE id=?", [scriptId]);
      if (row) {
        const chars = materialsOf(db, "characters", parseIds(String(row.character_ids || "")));
        const scenes = materialsOf(db, "scenes", parseIds(String(row.scene_ids || "")));
        const prods = materialsOf(db, "products", parseIds(String(row.product_ids || "")));
        const config = [b.resolution, b.ratio, b.duration ? `${b.duration}秒` : ""].filter(Boolean).join(" · ");
        if (materialsFp(chars, scenes, prods) !== String(row.materials_fp || "")) {
          const adapted = await adaptPrompt({ content: String(row.content || ""), characters: chars, scenes: scenes, products: prods, config });
          if (adapted && adapted.prompt) prompt = adapted.prompt;
        }
        scriptName = String(row.name || "");
      }
    }

    const task = await createVideoTask({
      modelKey: String(b.modelKey || ""),
      // 末尾附 生成硬性约束(严格遵守剧本/人物场景产品/角度正常等)
      prompt: `${prompt}\n${GENERATION_CONSTRAINTS}`.trim(),
      imageUrl: b.imageUrl || null,
      resolution: b.resolution || undefined,
      ratio: b.ratio || undefined,
      duration: b.duration && b.duration > 0 ? b.duration : undefined,
      scriptName,
    });
    // 真实任务已由 createVideoTask 落库(独立行); 删除占位行, 占位即刻被真实任务替代
    const db = await getDb();
    db.run(`DELETE FROM ${TABLE} WHERE id=?`, [placeholderId]);
    await persist();
  } catch (e) {
    // 失败: 占位标记 failed(视频库占位消失/显示错误), 不中断
    try {
      const db = await getDb();
      db.run(`UPDATE ${TABLE} SET status=?, error=?, video_url='', updated_at=? WHERE id=?`,
        ["failed", (e as Error).message.slice(0, 200), new Date().toISOString(), placeholderId]);
      await persist();
    } catch { /* ignore */ }
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: GenBody = {};
  try { b = (await req.json()) as GenBody; } catch { /* ignore */ }
  const modelKey = String(b.modelKey || "");
  if (!modelKey) return Response.json({ ok: false, detail: "缺少 modelKey" }, { status: 400 });
  try {
    await ensureVideoTables();
    // 绑定剧本 → 预取剧本名(占位卡片显示用; 毫秒级)
    let scriptName = b.scriptName || "";
    const scriptId = Number(b.scriptId);
    if (Number.isInteger(scriptId) && scriptId > 0) {
      const row = queryOne(await getDb(), "SELECT name FROM scripts WHERE id=?", [scriptId]);
      if (row) scriptName = String(row.name || "");
    }
    // 立即建占位 → 返回(视频库马上出现"生成中"); 适配/提交放后台
    const placeholder = await createPlaceholderTask({
      modelKey, prompt: String(b.prompt || ""),
      resolution: b.resolution, ratio: b.ratio,
      duration: b.duration && b.duration > 0 ? b.duration : undefined,
      scriptName,
    });
    void runGenerate({ ...b, scriptName }, placeholder.id);
    return Response.json({ ok: true, task: placeholder });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 400 });
  }
}

// 供类型引用(避免未使用告警)
export type { VideoTask };