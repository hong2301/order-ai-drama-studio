// 豆包(火山方舟 Ark) API 客户端: AI 对话模块使用
const ARK_API = "https://ark.cn-beijing.volces.com/api/v3";

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

export async function chat(apiKey: string, modelId: string, message: string, images: string[] = []): Promise<string> {
  // images: data URL(由服务端把本地上传图转 base64), 支持多模态输入
  const content: unknown[] = [{ type: "text", text: message }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img } });
  }
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
        messages: [{ role: "user", content }],
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