// 全局设置: settings 表 key-value(存界面偏好)
import type { NextRequest } from "next/server";
import { getDb, persist, queryOne } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

type Ctx = { params: Promise<{ key: string }> };
type SettingRow = { value: string };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const db = await getDb();
    const r = queryOne<SettingRow>(db, "SELECT value FROM settings WHERE key=?", [key]);
    return Response.json({ key, value: r?.value ?? "" });
  } catch (e) { return jsonError(500, (e as Error).message); }
}
export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  try {
    const { key } = await ctx.params;
    const p = (await req.json()) as { value?: string };
    const db = await getDb();
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run([key, p.value ?? ""]);
    persist();
    return Response.json({ ok: true });
  } catch (e) { return jsonError(500, (e as Error).message); }
}
