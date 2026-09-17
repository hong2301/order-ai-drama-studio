// 视频生成模型可用性探测 —— 给 AI / 控制台提供真实依据, 不靠静态标注猜
// 原理: 对每个注册表模型发一个 duration=999 的创建请求(必非法, 不会生成/扣费):
//   ModelNotOpen   -> 账号未开通
//   InvalidParameter(duration/参数非法) -> 模型可用(接口已响应能力校验)
//   其它(限流/网络/已下线) -> unknown
// 结果缓存 24h(data/model_probe_video.json); 探测为多模型并发, 首次约 10-30 秒
import fs from "fs";
import path from "path";
import { dataDir, getApiKey } from "@/lib/server/db";
import { activeModelDefs, MODELS } from "./registry";
import type { VideoModelDef } from "./types";

const ARK_API = "https://ark.cn-beijing.volces.com/api/v3";
const CACHE_TTL = 24 * 3600 * 1000;
const CACHE_FILE = "model_probe_video.json";
const CONCURRENCY = 4;
const REQ_TIMEOUT = 20000;

export interface VideoProbeItem {
  key: string;
  name: string;
  /** active=可用(接口响应) / inactive=账号未开通 / unknown=探测失败或其它 */
  status: "active" | "inactive" | "unknown";
  resolution?: string;
  pricePerSecond?: number;
  /** 探测说明 */
  note: string;
}

function apiKey(): Promise<string> {
  return getApiKey();
}

async function probeOne(def: VideoModelDef): Promise<VideoProbeItem["status"]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
  try {
    const resp = await fetch(`${ARK_API}/contents/generations/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: def.model,
        content: [{ type: "text", text: "t" }], // 最小内容; duration=999 必被接口拦截, 不会真生成
        duration: 999,
      }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (resp.ok) return "active"; // 竟然接受? 说明能收(实际不会走到)
    let code = "";
    try { code = (JSON.parse(text).error?.code as string) || ""; } catch { /* ignore */ }
    console.log(`[probe-video] ${def.name} -> code=${code} status=${resp.status} msg=${JSON.parse(text).error?.message || ""}`.slice(0, 160));
    if (code === "ModelNotOpen") return "inactive";
    if (code === "InvalidParameter") return "active"; // 参数校验都走到 → 模型可用
    return "unknown";
  } catch { return "unknown"; } finally {
    clearTimeout(timer);
  }
}

async function probeBatch(defs: VideoModelDef[]): Promise<Map<string, VideoProbeItem["status"]>> {
  const map = new Map<string, VideoProbeItem["status"]>();
  const queue = [...defs];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    while (queue.length) {
      const def = queue.shift()!;
      map.set(def.key, await probeOne(def));
    }
  });
  await Promise.all(workers);
  return map;
}

/** 探测全部注册表视频模型(强制 fresh=1 时忽略缓存重新探测) */
export async function probeVideoModels(force = false): Promise<{ items: VideoProbeItem[]; fromCache: boolean }> {
  const cachePath = path.join(dataDir(), CACHE_FILE);
  if (!force) {
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath, "utf8")) as { ts: number; items: VideoProbeItem[] };
      if (raw.ts && Date.now() - raw.ts < CACHE_TTL && Array.isArray(raw.items)) {
        return { items: raw.items, fromCache: true };
      }
    } catch { /* ignore */ }
  }
  // 探测对象: 可用 或 未开通(排除 已下线/即将下线 —— 那些不参与可用性判断)
  const targets = MODELS.filter((m) => m.status === "active" || m.status === "inactive");
  const result = await probeBatch(targets);
  const items: VideoProbeItem[] = targets.map((def) => {
    const st = result.get(def.key) || "unknown";
    const label = st === "active" ? "可用" : st === "inactive" ? "账号未开通" : "探测失败/不可用";
    return {
      key: def.key,
      name: def.name,
      status: st,
      resolution: def.presets?.resolutions?.join("/"),
      pricePerSecond: def.pricePerSecond,
      note: st === "active" ? "可用" : `${label}${def.note ? `(${def.note})` : ""}`,
    };
  });
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ ts: Date.now(), items }, null, 2));
  } catch { /* ignore */ }
  return { items, fromCache: false };
}

/** 供 AI 提示用的精简可用模型清单(方便一次性喂给模型) */
export async function availableVideoModelsBrief(): Promise<string> {
  const { items, fromCache } = await probeVideoModels();
  const ok = items.filter((i) => i.status === "active");
  const not = items.filter((i) => i.status === "inactive");
  const lines = [
    ok.length ? `可用(${ok.length}): ${ok.map((i) => `${i.name}${i.pricePerSecond ? ` ${i.pricePerSecond}元/秒` : ""}`).join("；")}` : "可用: 无",
  ];
  if (not.length) lines.push(`未开通(${not.length}): ${not.map((i) => i.name).join("、")}`);
  const unknown = items.filter((i) => i.status === "unknown");
  if (unknown.length) lines.push(`探测不到(${unknown.length}): ${unknown.map((i) => i.name).join("、")}`);
  lines.push(`(探测${fromCache ? "来自缓存(24h内)" : "刚完成"})`);
  return lines.join("\n");
}

// 供 import 使用(activeModelDefs 仍在 registry 使用处引用, 此处仅确保不误删)
export { activeModelDefs };