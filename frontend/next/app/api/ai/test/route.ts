// 校验 API Key 有效性 + 可选校验模型是否在账号模型列表中(只读, 不产生生成费用)
import type { NextRequest } from "next/server";
import { testKey, DoubaoError } from "@/lib/server/doubao";
import { jsonError } from "@/lib/server/http";

interface TestIn { api_key?: string; model_id?: string }

export async function POST(req: NextRequest): Promise<Response> {
  const p = (await req.json()) as TestIn;
  const apiKey = p.api_key || process.env.DOUBAO_API_KEY || "";
  if (!apiKey) return jsonError(400, "未提供 API Key");
  let r: { ok: boolean; total: number; models: string[] };
  try {
    r = await testKey(apiKey);
  } catch (e) {
    if (e instanceof DoubaoError) return jsonError(400, `Key 无效或网络错误: ${e.code}`);
    return jsonError(400, (e as Error).message);
  }
  if (p.model_id && !r.models.includes(p.model_id)) {
    return jsonError(400, `模型 ${p.model_id} 不在账号模型列表中`);
  }
  return Response.json({
    ok: true, total: r.total,
    model_available: !p.model_id || r.models.includes(p.model_id),
  });
}
