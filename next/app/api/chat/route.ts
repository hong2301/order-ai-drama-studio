// AI 对话: POST /api/chat {message, images?: string[](最多9张上传图url)} -> {reply}
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { chat, DoubaoError, type ChatMsg } from "@/lib/server/doubao";
import { dataDir } from "@/lib/server/db";

type Body = { message?: string; images?: string[]; messages?: ChatMsg[] };

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp",
};

/** /api/uploads/<folder>/<name> -> 本地文件 data URL */
function localImageToDataUrl(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  const file = path.join(dataDir(), "uploads", path.basename(m[1]), path.basename(m[2]));
  if (!fs.existsSync(file) || fs.statSync(file).size > 10 * 1024 * 1024) return null;
  const buf = fs.readFileSync(file);
  const ext = m[2].split(".").pop()?.toLowerCase() || "png";
  return `data:${MIME[ext] || "image/png"};base64,${buf.toString("base64")}`;
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch { /* ignore */ }
  const message = (b.message || "").trim();
  if (!message) return Response.json({ detail: "消息为空" }, { status: 400 });
  const images = (b.images || []).slice(0, 9)
    .map(localImageToDataUrl)
    .filter((x): x is string => !!x);

  // 多轮上下文: 取最近 20 条历史(过滤失败占位消息), 结尾追加当前提问
  const history: ChatMsg[] = (b.messages || [])
    .slice(-20)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() && !m.content.startsWith("(调用失败)") && !m.content.startsWith("(加载失败)"))
    .map((m) => ({
      role: m.role,
      content: m.content,
      images: (m.images || []).map(localImageToDataUrl).filter((x): x is string => !!x),
    }));
  history.push({ role: "user", content: message, images });

  const apiKey = process.env.DOUBAO_API_KEY || "";
  if (!apiKey) {
    return Response.json({ detail: "未配置 DOUBAO_API_KEY(见项目根 .env)" }, { status: 400 });
  }
  const modelId = process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";
  try {
    const reply = await chat(apiKey, modelId, history);
    return Response.json({ reply });
  } catch (e) {
    if (e instanceof DoubaoError) return Response.json({ detail: `对话失败: ${e.code}` }, { status: 502 });
    return Response.json({ detail: (e as Error).message }, { status: 500 });
  }
}