// 豆包(火山方舟 Ark) API 客户端: AI 对话模块使用
const ARK_API = "https://ark.cn-beijing.volces.com/api/v3";

/** 单条对话消息(images 为 data URL) */
export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

export class DoubaoError extends Error {
  code: string;
  http: number;
  detail: string;
  constructor(code: string, http: number, detail: string) {
    super(`${code} (HTTP ${http})`);
    this.code = code;
    this.http = http;
    this.detail = detail;
  }
}

export async function chat(apiKey: string, modelId: string, history: ChatMsg[]): Promise<string> {
  // 历史 -> 豆包格式(每条含 text + 多张图片 data URL), 支持多轮上下文
  let messages = history
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim())
    .map((h) => ({
      role: h.role,
      content: [
        { type: "text", text: h.content },
        ...(h.images || [])
          .filter((u): u is string => !!u)
          .map((img) => ({ type: "image_url", image_url: { url: img } })),
      ],
    }));
  if (!messages.length) throw new DoubaoError("EmptyHistory", 400, "对话历史为空");
  // 豆包要求最后一条是 user(若历史以 assistant 结尾则截掉末尾, 保证连续 user 提问)
  while (messages.length && messages[messages.length - 1].role !== "user") {
    messages = messages.slice(0, -1);
  }
  if (!messages.length) throw new DoubaoError("EmptyHistory", 400, "对话历史为空");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const resp = await fetch(`${ARK_API}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: 1024,
      }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      let code = `HTTP${resp.status}`;
      try { code = (JSON.parse(text).error?.code as string) || code; } catch { /* ignore */ }
      throw new DoubaoError(code, resp.status, text.slice(0, 300));
    }
    const r = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const reply = r.choices?.[0]?.message?.content;
    if (!reply) throw new DoubaoError("BadChatResponse", 200, text.slice(0, 300));
    return reply;
  } finally {
    clearTimeout(timer);
  }
}