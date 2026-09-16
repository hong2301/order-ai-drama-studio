// 豆包(火山方舟 Ark) API 客户端: AI 对话 + 工具调用(function calling)
const ARK_API = "https://ark.cn-beijing.volces.com/api/v3";

/** 单条对话消息(images/videos 为 data URL) */
export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
  videos?: string[];
}

/** 工具定义(OpenAI 兼容 schema) */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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

type Payload = {
  role: string;
  content: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

/**
 * 对话(支持多轮上下文 + 工具调用)。
 * opts.tools 提供工具定义; 模型请求调用工具时执行 opts.onToolCall(name, args) 并把结果回传,
 * 循环直到模型给出最终文本回复(最多 6 轮防止死循环)。
 */
export async function chat(
  apiKey: string,
  modelId: string,
  history: ChatMsg[],
  opts?: { tools?: ToolDef[]; onToolCall?: (name: string, args: Record<string, unknown>) => Promise<string> | string },
): Promise<string> {
  // 历史 -> 豆包格式(每条含 text + 图片/视频 data URL)
  const messages: Payload[] = history
    .filter((h) => h && (h.role === "system" || h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim())
    .map((h) => ({
      role: h.role,
      content: [
        { type: "text", text: h.content },
        ...(h.images || [])
          .filter((u): u is string => !!u)
          .map((img) => ({ type: "image_url", image_url: { url: img } })),
        ...(h.videos || [])
          .filter((u): u is string => !!u)
          .map((vid) => ({ type: "video_url", video_url: { url: vid } })),
      ],
    }));
  if (!messages.length) throw new DoubaoError("EmptyHistory", 400, "对话历史为空");
  // 豆包要求最后一条是 user
  while (messages.length && messages[messages.length - 1].role !== "user") {
    messages.pop();
  }
  if (!messages.length) throw new DoubaoError("EmptyHistory", 400, "对话历史为空");

  const tools = opts?.tools?.length
    ? opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
    : undefined;

  const baseBody: Record<string, unknown> = { model: modelId, messages, max_tokens: 2048 };
  if (tools) baseBody.tools = tools;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    // -------- 工具调用循环 --------
    for (let round = 0; round < 6; round++) {
      const resp = await fetch(`${ARK_API}/chat/completions`, {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(baseBody),
        signal: ctrl.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        let code = `HTTP${resp.status}`;
        try { code = (JSON.parse(text).error?.code as string) || code; } catch { /* ignore */ }
        throw new DoubaoError(code, resp.status, text.slice(0, 300));
      }
      const r = JSON.parse(text) as { choices?: { message?: { content?: unknown; tool_calls?: unknown[] } }[] };
      const msg = r.choices?.[0]?.message;
      const toolCalls = (msg?.tool_calls || []) as {
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];

      // 有工具请求 → 执行并把结果回填, 继续下一轮
      if (tools && toolCalls.length) {
        console.log(`[tool-call] ${toolCalls.map((tc) => tc.function?.name).join(",")}`);
        const assistantMsg: Payload = {
          role: "assistant",
          content: msg?.content ?? "",
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function?.name, arguments: tc.function?.arguments },
          })),
        };
        messages.push(assistantMsg);
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>; } catch { /* ignore */ }
          let result: string;
          try {
            const fn = opts?.onToolCall;
            const name = tc.function?.name || "";
            result = fn ? await fn(name, args) : `未实现的工具: ${name}`;
          } catch (e) {
            result = `工具执行出错: ${(e as Error).message}`;
          }
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue; // 下一轮: 模型基于工具结果给最终回复
      }

      // 无工具请求 → 直接返回文本
      const reply = typeof msg?.content === "string" && msg.content.trim() ? msg.content : "";
      if (!reply) throw new DoubaoError("BadChatResponse", 200, text.slice(0, 300));
      return reply;
    }
    throw new DoubaoError("ToolLoopLimit", 200, "工具调用超过 6 轮未结束");
  } finally {
    clearTimeout(timer);
  }
}