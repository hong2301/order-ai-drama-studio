// 三库历史重复清理: POST /api/library/dedupe
// 同名(名称归一化一致)的记录合并为一条: 身份/图片并集去重, 提示词 AI 融合, 剧本引用重指向
import { dedupeLibrary, type LibraryTable } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const tables: LibraryTable[] = ["characters", "scenes", "products"];
    const result: Record<string, unknown> = {};
    let removed = 0;
    for (const t of tables) {
      const r = await dedupeLibrary(t);
      result[t] = r;
      removed += r.removed;
    }
    return Response.json({ ok: true, removed, detail: result });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}