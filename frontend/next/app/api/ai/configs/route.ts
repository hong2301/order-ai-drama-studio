// AI 模型配置: 列表/创建
import type { NextRequest } from "next/server";
import { listConfigs, createConfig } from "@/lib/server/ai";
import { jsonError } from "@/lib/server/http";

export async function GET(): Promise<Response> {
  try { return Response.json(await listConfigs()); } catch (e) { return jsonError(500, (e as Error).message); }
}
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const cfg = await createConfig((await req.json()) as Record<string, unknown>);
    return Response.json(cfg);
  } catch (e) { return jsonError(400, `创建失败: ${(e as Error).message}`); }
}
