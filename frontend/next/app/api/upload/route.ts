// 图片上传: POST /api/upload  multipart(file + folder)
// 文件存到 <dataDir>/uploads/<folder>/<时间戳-随机>.ext, 通过 /api/uploads/<folder>/<name> 访问
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const ALLOW_EXT = ["jpg", "jpeg", "png", "gif", "webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, msg: "解析表单失败" }, { status: 400 });
  }
  const file = form.get("file");
  const folder = path.basename((form.get("folder") as string) || "misc");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ ok: false, msg: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, msg: "文件过大(上限 10MB)" }, { status: 400 });
  }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOW_EXT.includes(ext)) {
    return Response.json({ ok: false, msg: `仅支持图片: ${ALLOW_EXT.join("/")}` }, { status: 400 });
  }
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(dataDir(), "uploads", folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  const url = `/api/uploads/${folder}/${name}`;
  return Response.json({ ok: true, url, path: path.join("uploads", folder, name) });
}