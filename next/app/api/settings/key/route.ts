// API Key 设置: GET /api/settings/key 读取(明文) | PUT /api/settings/key 修改
// 存储: 数据库 settings 表(doubao_api_key), 不再写入 .env; 未配置时兜底返回 env
import type { NextRequest } from "next/server";
import { getApiKey, setSetting, getSetting } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const key = await getSetting<string>("doubao_api_key", "");
  return Response.json({ ok: true, key: key || process.env.DOUBAO_API_KEY || "" });
}

export async function PUT(req: NextRequest): Promise<Response> {
  let b: { key?: string } = {};
  try { b = (await req.json()) as typeof b; } catch { /* ignore */ }
  const key = String(b.key || "").trim();
  if (!key) return Response.json({ ok: false, detail: "API Key 不能为空" }, { status: 400 });
  try {
    await setSetting("doubao_api_key", key);
  } catch (e) {
    return Response.json({ ok: false, detail: `保存失败: ${(e as Error).message}` }, { status: 500 });
  }
  // 进程内顺带同步, 供仍读 env 的兜底路径(迁移前老进程)
  process.env.DOUBAO_API_KEY = key;
  return Response.json({ ok: true });
}