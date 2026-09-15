// 视频生成: POST /api/video/generate {modelKey, prompt, imageUrl?, resolution?, ratio?, duration?}
import type { NextRequest } from "next/server";
import { createVideoTask, ensureVideoTables } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let b: {
    modelKey?: string; prompt?: string; imageUrl?: string | null;
    resolution?: string; ratio?: string; duration?: number;
  } = {};
  try { b = (await req.json()) as typeof b; } catch { /* ignore */ }
  try {
    await ensureVideoTables();
    const task = await createVideoTask({
      modelKey: String(b.modelKey || ""),
      prompt: String(b.prompt || ""),
      imageUrl: b.imageUrl || null,
      resolution: b.resolution || undefined,
      ratio: b.ratio || undefined,
      duration: b.duration && b.duration > 0 ? b.duration : undefined,
    });
    return Response.json({ ok: true, task });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 400 });
  }
}