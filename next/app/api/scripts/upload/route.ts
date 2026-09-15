// 剧本文件上传: POST /api/scripts/upload multipart(file)
// 支持 txt / md(文本) / docx(word, 含图片提取); 读取内容存 content, 原文件存 uploads/scripts/
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { getDb, persist } from "@/lib/server/db";
import { dataDir } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOW_EXT = ["txt", "md", "docx"];

export async function POST(req: NextRequest): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Response.json({ detail: "解析表单失败" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ detail: "缺少文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ detail: "文件过大(上限 50MB)" }, { status: 400 });
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOW_EXT.includes(ext)) return Response.json({ detail: "仅支持 txt / md / word(.docx) 文件" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  // 1) 读取内容: docx 用 mammoth 转 HTML(文字+图片), txt 直接 utf8
  let content = "";
  if (ext === "docx") {
    try {
      const imgsDir = path.join(dataDir(), "uploads", "scripts_imgs");
      fs.mkdirSync(imgsDir, { recursive: true });
      const result = await mammoth.convertToHtml(
        { buffer: buf },
        {
          convertImage: mammoth.images.imgElement(async (img) => {
            const imageBuf = await img.read();
            const ctype = img.contentType || "";
            const imgExt = ctype.includes("png") ? "png" : ctype.includes("gif") ? "gif" : "jpg";
            const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${imgExt}`;
            fs.writeFileSync(path.join(imgsDir, fname), imageBuf);
            return { src: `/api/uploads/scripts_imgs/${fname}` };
          }),
        },
      );
      content = result.value || "";
    } catch {
      content = ""; // 解析失败至少能存文件
    }
  } else {
    content = buf.toString("utf8");
  }

  // 2) 保存原文件 → uploads/scripts/
  const savedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const dir = path.join(dataDir(), "uploads", "scripts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, savedName), buf);

  // 3) 入库: name = 文件名去扩展名
  const name = (file.name.replace(/\.\w+$/, "") || "未命名剧本").trim();
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    "INSERT INTO scripts(name, file_path, content, created_at, updated_at) VALUES(?,?,?,?,?)",
    [name, `/api/uploads/scripts/${savedName}`, content, now, now],
  );
  const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
  await persist();
  // 自动解析(识别人物/场景/产品/清晰度/时长/关键词; 失败不影响添加)
  let parse = null;
  try {
    const { parseScript } = await import("@/lib/server/scriptParse");
    parse = await parseScript(id);
  } catch { /* ignore */ }
  return Response.json({ ok: true, id, name, parse });
}