// 图片上传: POST /api/upload  multipart(file + folder) -> data/uploads/<folder>/<随机名>.ext
// 限制: 图片(jpg/jpeg/png/gif/webp), 单文件 ≤10MB; 数量上限由前端控制(≤9)
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024; // 单文件 ≤50MB(图片/文档/视频等通用附件)

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, msg: "解析表单失败" }, { status: 400 });
  }
  const file = form.get("file");
  const folder = path.basename((form.get("folder") as string) || "chat");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, msg: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, msg: "文件过大(上限 10MB)" }, { status: 400 });
  }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(dataDir(), "uploads", folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ ok: true, url: `/api/uploads/${folder}/${name}`, name });
}