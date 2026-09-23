// 图片: POST /api/images/upload 上传(multipart: file + name? + description?)
// 文件存 data/uploads/images/, 记录入 images 表
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, persist } from "@/lib/server/db";
import { dataDir } from "@/lib/server/db";
import { readImageSize } from "@/lib/server/video";

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOW_EXT = ["jpg", "jpeg", "jfif", "png", "gif", "webp"];
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
};

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Response.json({ detail: "解析表单失败" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ detail: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ detail: "文件过大(上限 20MB)" }, { status: 400 });
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOW_EXT.includes(ext)) return Response.json({ detail: "仅支持图片: " + ALLOW_EXT.join("/") }, { status: 400 });

  const savedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(dataDir(), "uploads", "images");
  fs.mkdirSync(dir, { recursive: true });
  const savedFile = path.join(dir, savedName);
  fs.writeFileSync(savedFile, Buffer.from(await file.arrayBuffer()));

  // 尺寸要求: 避免日后作为首帧/图生被方舟拒绝(宽需≥300px)
  const size = readImageSize(savedFile);
  if (size && size.w < 300) {
    fs.unlinkSync(savedFile); // 过小不入库
    return Response.json({ detail: `图片过小：${size.w}×${size.h}px，宽需 ≥300px，请上传更大图片` }, { status: 400 });
  }

  const name = (form.get("name") as string || file.name.replace(/\.\w+$/, "")).trim();
  const description = (form.get("description") as string || "").trim();
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    "INSERT INTO images(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
    [`/api/uploads/images/${savedName}`, name, description, now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id, path: `/api/uploads/images/${savedName}` });
}