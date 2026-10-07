// 火山方舟(豆包) 视频生成 provider — OpenAI 兼容异步任务接口
// 创建: POST /api/v3/contents/generations/tasks  查询: GET .../tasks/{id}
import fs from "fs";
import path from "path";
import { dataDir, getApiKey } from "@/lib/server/db";
import type { VideoProvider, VideoProviderTask, VideoSubmitRequest, VideoTaskStatus } from "../types";

const ARK_API = "https://ark.cn-beijing.volces.com/api/v3";

async function apiKey(): Promise<string> {
  const k = (await getApiKey()).trim();
  if (!k) throw new Error("未配置 API Key(请点右上角 API Key 按钮设置)");
  return k;
}

/** 本地 /api/uploads/... 路径 -> 公网不可达, 转 data URL(方舟接受 base64); 公网 URL 原样返回 */
function toWireUrl(url: string): string {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return url;
  const file = path.join(dataDir(), "uploads", m[1], m[2]);
  if (!fs.existsSync(file)) throw new Error(`附件不存在: ${url}`);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  const type = mime[ext] || "application/octet-stream";
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
}

const STATUS_MAP: Record<string, VideoTaskStatus> = {
  queued: "queued", running: "running", succeeded: "succeeded", failed: "failed", cancelled: "cancelled",
};

async function request<T>(pathname: string, init?: RequestInit, timeoutMs = 60000): Promise<T> {
  // 提交等时延用 30s(快速失败), 查询用默认 60s; 配合上层的"占位超时兜底"
  const resp = await fetch(`${ARK_API}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${await apiKey()}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await resp.text();
  if (!resp.ok) {
    let code = `HTTP${resp.status}`;
    let detail = "";
    try {
      const j = JSON.parse(text);
      code = j.error?.code || code;
      detail = j.error?.message || "";
    } catch { /* ignore */ }
    throw new Error(`${code}${detail ? `: ${detail}` : ""}`);
  }
  return JSON.parse(text) as T;
}

async function postTask(body: Record<string, unknown>): Promise<{ id: string; status?: string }> {
  const payload = JSON.stringify(body);
  // 提交受理通常秒级返回; 但多图参考时请求体可达数十 MB, 上传本身就要几十秒
  // —— 按体积给超时(基准 30s + 每 MB 3s, 上限 180s), 避免大请求被误判超时
  const mb = Buffer.byteLength(payload) / 1048576;
  const timeout = Math.min(180000, 30000 + Math.ceil(mb) * 3000);
  if (mb > 5) console.log(`[video] 提交请求体 ${mb.toFixed(1)}MB, 超时放宽至 ${(timeout / 1000).toFixed(0)}s`);
  return request<{ id: string; status?: string }>("/contents/generations/tasks", { method: "POST", body: payload }, timeout);
}

/** 从接口错误里解析时长上限(方舟: "duration ... must be less than or equal to 12") — 上限由接口定, 代码不写死 */
function parseDurationLimit(msg: string): number | null {
  const m = /duration[^.]*?less than or equal to\s+(\d+)/i.exec(msg);
  return m ? Number(m[1]) : null;
}

/**
 * 提交并容错:
 * - 时长超上限: 取**接口返回的上限**重试(不本地写死上限), 并记录原值供提示
 * - 其它参数不支持(InvalidParameter): 逐个去掉重试(便于扩展新模型)
 * 注意: 不再静默删掉 duration —— 否则用户拿不到想要的时长且无任何提示
 */
async function submitWithFallback(body: Record<string, unknown>): Promise<{ id: string; status?: string; durationUsed?: number; durationAdjustedFrom?: number }> {
  try {
    return await postTask(body);
  } catch (e) {
    const msg = (e as Error).message;
    if (!/InvalidParameter/.test(msg)) throw e;
    // 1) 时长超接口上限 → 按接口给的上限重试
    const limit = parseDurationLimit(msg);
    if (limit && typeof body.duration === "number" && body.duration > limit) {
      const r = await postTask({ ...body, duration: limit });
      return { ...r, durationUsed: limit, durationAdjustedFrom: body.duration };
    }
    // 2) 其它参数不支持 → 去掉该参数重试
    for (const k of ["resolution", "ratio"] as const) {
      if (body[k] !== undefined) {
        const next = { ...body };
        delete next[k];
        try {
          const r = await postTask(next);
          const used = typeof next.duration === "number" ? next.duration : undefined;
          return { ...r, durationUsed: used };
        } catch (e2) {
          if (!/InvalidParameter/.test((e2 as Error).message)) throw e2;
        }
      }
    }
    throw e;
  }
}

export const doubaoVideo: VideoProvider = {
  id: "doubao",
  name: "火山方舟(豆包)",

  async submit(req: VideoSubmitRequest) {
    // 方舟 content 元素统一是 { type: 'image_url', image_url: { url }, role? }:
    //   role 省略   = 图生视频-首帧
    //   first_frame / last_frame = 图生视频-首尾帧
    //   reference_image          = 全模态参考生视频(人物/场景/产品锚定)
    const content: Record<string, unknown>[] = req.prompt?.trim() ? [{ type: "text", text: req.prompt.trim() }] : [];
    if (req.imageUrl) content.push({ type: "image_url", image_url: { url: toWireUrl(req.imageUrl) } });
    if (req.lastFrameUrl) {
      content.push({ type: "image_url", image_url: { url: toWireUrl(req.lastFrameUrl) }, role: "last_frame" });
    }
    // 参考图必须进 content 且带 role=reference_image。
    // 旧实现写在顶层 body.reference —— 方舟无此字段, 会被静默忽略(任务照样成功但图片完全没参与生成)。
    for (const r of req.referenceImages || []) {
      content.push({ type: "image_url", image_url: { url: toWireUrl(r.url) }, role: "reference_image" });
    }
    if (!content.length) throw new Error("至少需要提示词或图片");

    const body: Record<string, unknown> = { model: req.model, content };
    // 有参考图时显式声明任务类型(默认 auto, 显式传入更稳)
    if (req.referenceImages?.length) body.omni_reference_task_type = "reference";
    if (req.resolution) body.resolution = req.resolution;
    if (req.ratio) body.ratio = req.ratio;
    if (req.duration) body.duration = req.duration; // 数字(方舟要求数值型, 字符串会 InvalidParameter)

    const r = await submitWithFallback(body);
    return {
      id: r.id,
      status: STATUS_MAP[r.status || "queued"] ?? "queued",
      durationUsed: r.durationUsed ?? req.duration,
      durationAdjustedFrom: r.durationAdjustedFrom,
    };
  },

  async get(taskId: string) {
    const r = await request<{
      status?: string; content?: { video_url?: string } | null; error?: { code?: string; message?: string } | null;
    }>(`/contents/generations/tasks/${taskId}`);
    const out: VideoProviderTask = {
      id: taskId,
      status: STATUS_MAP[r.status || "queued"] ?? "queued",
      videoUrl: r.content?.video_url || null,
      error: r.error ? `${r.error.code || "ERR"}${r.error.message ? `: ${r.error.message}` : ""}` : null,
    };
    return out;
  },
};