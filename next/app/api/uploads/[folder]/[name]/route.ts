// 本地上传文件静态访问: GET /api/uploads/<folder>/<name>
import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp",
};

type Ctx = { params: Promise<{ folder: string; name: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const { folder, name } = await ctx.params;
  const file = path.join(dataDir(), "uploads", path.basename(folder), path.basename(name));
  if (!fs.existsSync(file)) return new Response("文件不存在", { status: 404 });
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}