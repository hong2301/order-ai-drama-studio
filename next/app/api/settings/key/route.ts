// API Key 设置: GET /api/settings/key 读取(明文) | PUT /api/settings/key 修改
// 修改后: 进程内即时生效(process.env) + 持久化到根 .env(下次启动仍生效)
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** 定位项目根 .env(dev = next/../.env; 找不到则回退 cwd) */
function envPath(): string {
  const cands = [path.join(process.cwd(), "..", ".env"), path.join(process.cwd(), ".env")];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return cands[0]; // 默认写 next 上一级
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, key: process.env.DOUBAO_API_KEY || "" });
}

export async function PUT(req: NextRequest): Promise<Response> {
  let b: { key?: string } = {};
  try { b = (await req.json()) as typeof b; } catch { /* ignore */ }
  const key = String(b.key || "").trim();
  if (!key) return Response.json({ ok: false, detail: "API Key 不能为空" }, { status: 400 });

  // 持久化到 .env(更新或追加 DOUBAO_API_KEY)
  try {
    const file = envPath();
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const lines = raw.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^DOUBAO_API_KEY=/.test(l.trim()));
    const line = `DOUBAO_API_KEY=${key}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    fs.writeFileSync(file, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  } catch (e) {
    return Response.json({ ok: false, detail: `写入 .env 失败: ${(e as Error).message}` }, { status: 500 });
  }

  // 进程内即时生效(对话/解析/生成/探测都从 process.env 读取)
  process.env.DOUBAO_API_KEY = key;
  return Response.json({ ok: true });
}