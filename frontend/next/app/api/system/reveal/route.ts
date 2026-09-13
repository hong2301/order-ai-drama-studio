// 打开文件资源管理器并选中本地文件(桌面环境可用)
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const p = (await req.json()) as { path?: string };
    if (!p.path || !fs.existsSync(p.path)) return Response.json({ ok: false, msg: "文件不存在" });
    await new Promise<void>((resolve) => {
      exec(`explorer /select, "${path.normalize(p.path!)}"`, { windowsHide: true }, () => resolve());
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, msg: (e as Error).message });
  }
}
