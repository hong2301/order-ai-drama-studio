// AI 对话: POST /api/chat {message, images?: string[](附件url), messages?: 历史}
// 支持工具调用: 附件 txt/docx 内容注入上下文; add_script 工具把剧本内容写入剧本库
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { chat, DoubaoError, type ChatMsg, type ToolDef } from "@/lib/server/doubao";
import { dataDir, getDb, persist } from "@/lib/server/db";

type Body = { message?: string; images?: string[]; messages?: ChatMsg[]; model?: string };

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
  const filePath = String(args.file_path ?? "").trim();
  const name = String(args.name ?? "").trim() || content.split(/\r?\n/)[0].trim().slice(0, 30) || "未命名";
  const now = new Date().toISOString();
  try {
    const db = await getDb();
    db.run(
      "INSERT INTO scripts(name, file_path, content, created_at, updated_at) VALUES(?,?,?,?,?)",
      [name, filePath, content, now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    await persist();
    // AI 添加后同样自动解析(识别人物/场景/产品/清晰度/时长/关键词; 失败不影响)
    let parse = null;
    try {
      const { parseScript } = await import("@/lib/server/scriptParse");
      parse = await parseScript(id);
    } catch { /* ignore */ }
    return JSON.stringify({ ok: true, id, name, parse });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: (e as Error).message });
  }
}

const ADD_SCRIPT_TOOL: ToolDef = {
  name: "add_script",
  description: "将剧本内容/提示词保存到剧本库。**仅在用户明确要求「加入剧本库/保存剧本/记录到剧本库」时调用**；只读文件内容、回答关于文件的问题时绝不要调用(用 read_file)。内容来自附件文件时须带 file_path。",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "剧本名称(可选, 不填则取内容首行)" },
      content: { type: "string", description: "剧本完整内容或提示词" },
      file_path: { type: "string", description: "内容来自用户附件时填其在 data 目录下的路径, 如 data/uploads/chat/xxx.docx" },
    },
    required: ["content"],
  },
};

/** 读取用户附件文件内容(仅文本文件), 不写入剧本库 */
async function execReadFile(args: Record<string, unknown>): Promise<string> {
  const raw = String(args.path ?? "").trim();
  const m = /^data\/uploads\/(.+)$/.exec(raw);
  if (!m) return JSON.stringify({ ok: false, detail: "path 应为 data/uploads/... 格式" });
  const file = path.join(dataDir(), "uploads", m[1]);
  if (!fs.existsSync(file)) return JSON.stringify({ ok: false, detail: "文件不存在" });
  const ext = path.extname(file).slice(1).toLowerCase();
  let text = "";
  try {
    if (ext === "docx") text = (await mammoth.extractRawText({ buffer: fs.readFileSync(file) })).value || "";
    else if (ext === "txt" || ext === "md") text = fs.readFileSync(file, "utf8");
    else return JSON.stringify({ ok: false, detail: "该文件类型无法读取文本" });
  } catch {
    return JSON.stringify({ ok: false, detail: "读取文件失败" });
  }
  if (!text.trim()) return JSON.stringify({ ok: false, detail: "文件无文本内容" });
  return text.slice(0, 20000);
}

/** 资料库(人物/场景/产品)写库工具 — 与 add_script 同级 */
const LIB_META: Record<string, { table: string; typeName: string; label: string }> = {
  add_character: { table: "characters", typeName: "人物", label: "身份" },
  add_scene:     { table: "scenes",     typeName: "场景", label: "类型" },
  add_product:   { table: "products",   typeName: "产品", label: "品类" },
};

function buildLibTool(name: string): ToolDef {
  const m = LIB_META[name];
  return {
    name,
    description: `把用户提供的内容保存为一条${m.typeName}记录到资料库。**仅在用户明确要求「加入${m.typeName}库/保存到${m.typeName}库/记录${m.typeName}」时调用**；只是谈论/描述时绝不要调用。内容来自附件文件时可先 read_file 读取再整理。`,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: `${m.typeName}名称` },
        identity: { type: "array", items: { type: "string" }, description: `${m.label}标签数组(如人物为 主角/婆婆)` },
        prompt: { type: "string", description: `${m.typeName}提示词/描述, 从用户内容中整理` },
      },
      required: ["name", "prompt"],
    },
  };
}

const LIB_TOOLS: ToolDef[] = Object.keys(LIB_META).map((n) => buildLibTool(n));

/** 写入资料库表(表名取自白名单, 防注入) */
async function execLibAdd(table: string, args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? "").trim();
  const prompt = String(args.prompt ?? "").trim();
  if (!name) return JSON.stringify({ ok: false, detail: "名称不能为空" });
  if (!prompt) return JSON.stringify({ ok: false, detail: "提示词不能为空" });
  const identity = Array.isArray(args.identity) ? args.identity.map((s) => String(s).trim()).filter(Boolean) : [];
  const now = new Date().toISOString();
  try {
    const db = await getDb();
    db.run(
      `INSERT INTO ${table}(name, identity, prompt, image_ids, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
      [name, JSON.stringify(identity), prompt, "[]", now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    await persist();
    return JSON.stringify({ ok: true, id, name });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: (e as Error).message });
  }
}

const READ_FILE_TOOL: ToolDef = {
  name: "read_file",
  description: "读取用户上传的附件文件(txt/docx)内容。用户要求「看一下文件/读文件/文件里写了什么/帮我看这个文件」时调用。注意: 读取内容不等于保存, 只有用户明确要求加入剧本库时才用 add_script。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "附件在 data 目录下的路径, 如 data/uploads/chat/xxx.txt" },
    },
    required: ["path"],
  },
};

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch { /* ignore */ }
  const message = (b.message || "").trim();
  if (!message) return Response.json({ detail: "消息为空" }, { status: 400 });

  // ---------- 附件: 图片 -> data URL; txt/docx -> 文本注入当前消息(附带 data 路径) ----------
  const images: string[] = [];
  let attachText = "";
  const attachFiles: { name: string; path: string }[] = []; // txt/docx 附件(供 add_script 兜底 file_path)
  for (const u of (b.images || []).slice(0, 9)) {
    const img = localImageToDataUrl(u);
    if (img) { images.push(img); continue; }
    const at = await attachTextOf(u);
    if (at) {
      const dataPath = `data${u.slice(4)}`; // /api/uploads/... -> data/uploads/...
      attachFiles.push({ name: at.name, path: dataPath });
      attachText += `\n\n[附件文件 ${dataPath} 内容]\n${at.text}\n[/附件]`;
    }
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
  // 模型优先级: 前端传入 > 环境变量 > 默认(前端切换模型时传)
  const modelId = String(b.model || "").trim() || process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";

  try {
    let scriptsChanged = false;
    const reply = await chat(apiKey, modelId, history, {
      tools: [ADD_SCRIPT_TOOL, READ_FILE_TOOL, ...LIB_TOOLS],
      onToolCall: async (name, args) => {
        const lib = LIB_META[name];
        if (lib) {
          const r = await execLibAdd(lib.table, args);
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        if (name === "add_script") {
          // 工具未传 file_path 且内容来自附件时, 用附件文件路径驼底
          if (!String(args.file_path ?? "").trim() && attachFiles.length) {
            args.file_path = attachFiles[0].path;
          }
          const r = await execAddScript(args);
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        if (name === "read_file") {
          return await execReadFile(args);
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