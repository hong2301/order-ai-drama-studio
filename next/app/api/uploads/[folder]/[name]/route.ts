// 本地上传文件静态访问: GET /api/uploads/<folder>/<name>
import fs from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain", md: "text/markdown", json: "application/json", csv: "text/csv",
  html: "text/html",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
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