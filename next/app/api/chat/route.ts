// AI 对话: POST /api/chat {message, images?: string[](附件url), messages?: 历史}
// 支持工具调用: 附件 txt/docx 内容注入上下文; add_script 工具把剧本内容写入剧本库
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { chat, DoubaoError, type ChatMsg, type ToolDef } from "@/lib/server/doubao";
import { dataDir, getDb, persist } from "@/lib/server/db";

type Body = { message?: string; images?: string[]; messages?: ChatMsg[] };

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp",
};

/** /api/uploads/<folder>/<name> -> 本地文件绝对路径(带扩展名校验) */
function uploadFilePath(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  const file = path.join(dataDir(), "uploads", path.basename(m[1]), path.basename(m[2]));
  return fs.existsSync(file) ? file : null;
}

/** 图片附件 -> data URL */
function localImageToDataUrl(url: string): string | null {
  const file = uploadFilePath(url);
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!MIME[ext]) return null;
  if (fs.statSync(file).size > 10 * 1024 * 1024) return null;
  return `data:${MIME[ext]};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** 文本附件(txt/docx) -> 读取内容, 注入到消息里让 AI 可读; 其他返回 null */
async function attachTextOf(url: string): Promise<{ name: string; text: string } | null> {
  const file = uploadFilePath(url);
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  let text = "";
  try {
    if (ext === "docx") {
      text = (await mammoth.extractRawText({ buffer: fs.readFileSync(file) })).value || "";
    } else if (ext === "txt" || ext === "md") {
      text = fs.readFileSync(file, "utf8");
    } else {
      return null;
    }
  } catch { return null; }
  if (!text.trim()) return null;
  return { name: path.basename(file), text };
}

// ---------- 剧本库工具 ----------
/** 把内容写入 scripts 表(与 POST /api/scripts 相同逻辑) */
async function execAddScript(args: Record<string, unknown>): Promise<string> {
  const content = String(args.content ?? "").trim();
  if (!content) return JSON.stringify({ ok: false, detail: "内容为空" });
  const name = String(args.name ?? "").trim() || content.split(/\r?\n/)[0].trim().slice(0, 30) || "未命名";
  const now = new Date().toISOString();
  try {
    const db = await getDb();
    db.run(
      "INSERT INTO scripts(name, file_path, content, created_at, updated_at) VALUES(?,?,?,?,?)",
      [name, "", content, now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    await persist();
    return JSON.stringify({ ok: true, id, name });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: (e as Error).message });
  }
}

const ADD_SCRIPT_TOOL: ToolDef = {
  name: "add_script",
  description: "把用户提供的剧本内容或提示词保存到剧本库。当用户说\"加入剧本库/保存剧本/记录剧本\"或提供剧本文字时调用；可从用户附件(剧本文件)内容中提取剧本正文。",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "剧本名称(可选, 不填则取内容首行)" },
      content: { type: "string", description: "剧本完整内容或提示词" },
    },
    required: ["content"],
  },
};

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch { /* ignore */ }
  const message = (b.message || "").trim();
  if (!message) return Response.json({ detail: "消息为空" }, { status: 400 });

  // ---------- 附件: 图片 -> data URL; txt/docx -> 文本注入当前消息 ----------
  const images: string[] = [];
  let attachText = "";
  for (const u of (b.images || []).slice(0, 9)) {
    const img = localImageToDataUrl(u);
    if (img) { images.push(img); continue; }
    const at = await attachTextOf(u);
    if (at) attachText += `\n\n[附件文件 ${at.name} 内容]\n${at.text}\n[/附件]`;
  }

  // ---------- 上下文 ----------
  const history: ChatMsg[] = (b.messages || [])
    .slice(-20)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() && !m.content.startsWith("(调用失败)") && !m.content.startsWith("(加载失败)"))
    .map((m) => ({
      role: m.role,
      content: m.content,
      images: (m.images || []).map(localImageToDataUrl).filter((x): x is string => !!x),
    }));
  history.push({ role: "user", content: attachText ? `${message}\n${attachText}` : message, images });

  const apiKey = process.env.DOUBAO_API_KEY || "";
  if (!apiKey) return Response.json({ detail: "未配置 DOUBAO_API_KEY(见项目根 .env)" }, { status: 400 });
  const modelId = process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";

  try {
    let scriptsChanged = false;
    const reply = await chat(apiKey, modelId, history, {
      tools: [ADD_SCRIPT_TOOL],
      onToolCall: async (name, args) => {
        if (name === "add_script") {
          const r = await execAddScript(args);
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        return JSON.stringify({ ok: false, detail: `未知工具 ${name}` });
      },
    });
    return Response.json({ reply, scriptsChanged });
  } catch (e) {
    if (e instanceof DoubaoError) return Response.json({ detail: `对话失败: ${e.code}` }, { status: 502 });
    return Response.json({ detail: (e as Error).message }, { status: 500 });
  }
}