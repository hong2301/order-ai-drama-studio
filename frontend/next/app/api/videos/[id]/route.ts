// 本地成品视频静态访问: /api/videos/<id>.mp4 (支持 Range, 供 <video> 拖动播放)
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import type { NextRequest } from "next/server";
import { videosDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const name = path.basename(id);                      // 防目录穿越
  if (!/^\d+\.mp4$/i.test(name)) return new Response("非法文件名", { status: 400 });
  const file = path.join(videosDir(), name);
  if (!fs.existsSync(file)) return new Response("视频不存在", { status: 404 });

  const size = fs.statSync(file).size;
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end) return new Response(null, { status: 416 });
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      },
    });
  }
  const stream = fs.createReadStream(file);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}