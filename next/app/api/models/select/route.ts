// 对话模型选择同步: POST /api/models/select {model}
// 保存到 settings.chat_model —— 剧本解析/剧情适配 与 AI 对话模块使用同一模型
import type { NextRequest } from "next/server";
import { setSetting } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let b: { model?: string } = {};
  try { b = (await req.json()) as typeof b; } catch { /* ignore */ }
  const model = String(b.model || "").trim();
  if (!model) return Response.json({ ok: false, detail: "模型不能为空" }, { status: 400 });
  await setSetting("chat_model", model);
  return Response.json({ ok: true, model });
}