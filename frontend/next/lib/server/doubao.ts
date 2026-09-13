// 豆包(火山方舟 Ark) API 客户端(Node fetch 版, 移植自 backend/app/services/doubao_client.py)
import { logger } from "./logger";

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

async function request(
  apiKey: string, path: string, method = "GET", body?: unknown, timeout = 60000
): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(ARK_API + path, {
      method,
      headers: {
        Authorization: "Bearer " + (apiKey || ""),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      let code = `HTTP${resp.status}`;
      try { code = (JSON.parse(text).error?.code as string) || code; } catch { /* ignore */ }
      logger.warn("[doubao] %s %s -> %s", method, path, code);
      throw new DoubaoError(code, resp.status, text.slice(0, 300));
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof DoubaoError) throw e;
    const msg = (e as Error).message || String(e);
    logger.warn("[doubao] %s %s -> 网络异常: %s", method, path, msg);
    throw new DoubaoError("NetworkError", 0, msg.slice(0, 300));
  } finally {
    clearTimeout(timer);
  }
}

/** 校验 key: 成功返回 {ok,total,models(全部)}; 失败抛 DoubaoError */
export async function testKey(apiKey: string): Promise<{ ok: boolean; total: number; models: string[] }> {
  const r = await request(apiKey, "/models", "GET", undefined, 30000);
  const models = ((r.data as { id: string }[]) || []).map((m) => m.id);
  return { ok: true, total: models.length, models };
}

export interface VideoSubmitOpts {
  resolution?: string; duration?: number; ratio?: string; seed?: number; fps?: number;
}

/** 提交文字生成视频任务 -> task_id */
export async function submitVideo(
  apiKey: string, modelId: string, prompt: string, opts: VideoSubmitOpts = {}
): Promise<string> {
  const body = {
    model: modelId,
    content: [{ type: "text", text: prompt }],
    resolution: opts.resolution ?? "720p",
    duration: opts.duration ?? 5,
    ratio: opts.ratio ?? "9:16",
    watermark: true,
    seed: opts.seed ?? -1,
    fps: opts.fps ?? 24,
  };
  const r = await request(apiKey, "/contents/generations/tasks", "POST", body, 60000);
  const tid = r.id as string | undefined;
  if (!tid) throw new DoubaoError("NoTaskId", 200, JSON.stringify(r).slice(0, 300));
  return tid;
}

export interface VideoState {
  task_id: string; status: string; video_url: string; seed: number;
  usage: Record<string, unknown>; raw: Record<string, unknown>;
}

/** 查询任务状态 */
export async function queryVideo(apiKey: string, taskId: string): Promise<VideoState> {
  const r = await request(apiKey, `/contents/generations/tasks/${taskId}`, "GET", undefined, 30000);
  const content = (r.content as Record<string, unknown>) || {};
  return {
    task_id: (r.id as string) || taskId,
    status: (r.status as string) || "",
    video_url: (content.video_url as string) || "",
    seed: (r.seed as number) ?? -1,
    usage: (r.usage as Record<string, unknown>) || {},
    raw: r,
  };
}

/** 文本对话(标准 chat/completions), 返回回复文本 */
export async function chat(apiKey: string, modelId: string, text: string, timeout = 60000): Promise<string> {
  const r = await request(apiKey, "/chat/completions", "POST", {
    model: modelId,
    messages: [{ role: "user", content: text }],
    max_tokens: 200,
  }, timeout);
  try {
    const choices = r.choices as { message: { content: string } }[];
    return choices[0].message.content;
  } catch {
    throw new DoubaoError("BadChatResponse", 200, JSON.stringify(r).slice(0, 300));
  }
}