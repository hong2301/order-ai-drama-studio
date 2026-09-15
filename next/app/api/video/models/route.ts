// 视频模型列表: GET /api/video/models
import { listModelDefs } from "@/lib/server/video";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // 视频模型(按单次费用从低到高排序, 便宜优先)
  const models = [...listModelDefs()].sort((a, b) => (a.pricePerSecond ?? 99) - (b.pricePerSecond ?? 99));
  return Response.json({ ok: true, models });
}