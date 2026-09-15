// AI 对话模型列表: GET /api/models
// 自动探测账号已开通可输入 图片/视频/文本 的多模态对话模型(缓存24h, ?fresh=1 强制重探测)
import type { NextRequest } from "next/server";
import { listChatableMediaModels } from "@/lib/server/video/modelsProbe";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const force = req.nextUrl.searchParams.get("fresh") === "1";
    const { models, loading } = await listChatableMediaModels(force);
    return Response.json({
      ok: true,
      models: models.map((m) => ({ id: m.id, label: m.label, price: m.price })),
      default: process.env.DOUBAO_CHAT_MODEL || "",
      loading, // true = 本次为首次探测(前端可显示"正在适配模型…")
    });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 500 });
  }
}