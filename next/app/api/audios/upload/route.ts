// 音频: POST /api/audios/upload 上传(multipart: file + name? + description?)
// 文件存 data/uploads/audios/, 记录入 audios 表。用于人物库的「音色参考音频」。
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, persist, dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;
const ALLOW_EXT = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Response.json({ detail: "解析表单失败" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ detail: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ detail: "文件过大(上限 30MB)" }, { status: 400 });
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOW_EXT.includes(ext)) return Response.json({ detail: "仅支持音频: " + ALLOW_EXT.join("/") }, { status: 400 });

  const savedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(dataDir(), "uploads", "audios");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, savedName), Buffer.from(await file.arrayBuffer()));

  const name = (form.get("name") as string || file.name.replace(/\.\w+$/, "")).trim() || "音色";
  const description = (form.get("description") as string || "").trim();
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    "INSERT INTO audios(path, name, description, created_at, updated_at) VALUES(?,?,?,?,?)",
    [`/api/uploads/audios/${savedName}`, name, description, now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  return Response.json({ ok: true, id, name, path: `/api/uploads/audios/${savedName}` });
}
