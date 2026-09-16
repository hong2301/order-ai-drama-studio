// 版本: GET /api/version —— 返回当前应用版本(读 next/package.json, 与打包版本同源)
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let version = "0.0.0";
  try {
    // dev/standalone 下 cwd 即 next 目录(standalone 收整成 next-server 时 package.json 在根)
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    version = pkg.version || version;
  } catch { /* ignore */ }
  return Response.json({ ok: true, version });
}