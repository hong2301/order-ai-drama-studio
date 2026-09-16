// 视频生成: POST /api/video/generate
// body: {modelKey, prompt?, scriptId?, imageUrl?, resolution?, ratio?, duration?}
// 传 scriptId 时: 读取剧本绑定的 人物/场景/产品(与三库勾选同步), AI 做一致性检查,
// 若配置与固定提示词有出入 → 用适配后的提示词生成; 适配失败/无出入 → 原提示词。
import type { NextRequest } from "next/server";
import { getDb, queryAll, queryOne } from "@/lib/server/db";
import { adaptPrompt, materialsFp } from "@/lib/server/video/adapt";
import { createVideoTask, ensureVideoTables } from "@/lib/server/video";

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

export async function POST(req: NextRequest): Promise<Response> {
  let b: {
    modelKey?: string; prompt?: string; scriptId?: number | null;
    imageUrl?: string | null; resolution?: string; ratio?: string; duration?: number;
    scriptName?: string;
  } = {};
  try { b = (await req.json()) as typeof b; } catch { /* ignore */ }

  try {
    await ensureVideoTables();
    let prompt = String(b.prompt || "");

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
        // 物料指纹一致(三库未修改过) → 剧情与配置本就对齐, 跳过一致性检测
        if (materialsFp(chars, scenes, prods) !== String(row.materials_fp || "")) {
          const adapted = await adaptPrompt({ content: String(row.content || ""), characters: chars, scenes: scenes, products: prods, config });
          if (adapted && adapted.prompt) prompt = adapted.prompt;
        }
        b.scriptName = String(row.name || "");
      }
    }

    const task = await createVideoTask({
      modelKey: String(b.modelKey || ""),
      prompt,
      imageUrl: b.imageUrl || null,
      resolution: b.resolution || undefined,
      ratio: b.ratio || undefined,
      duration: b.duration && b.duration > 0 ? b.duration : undefined,
      scriptName: b.scriptName || undefined,
    });
    return Response.json({ ok: true, task });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 400 });
  }
}