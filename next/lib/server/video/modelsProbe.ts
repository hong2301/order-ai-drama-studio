// AI 模型自动适配: 探测火山方舟上"已开通可用"的对话模型
// 对候选模型逐个发轻量 chat 请求(max_tokens=1), ModelNotOpen/NotFound 即未开通 → 不显示。
// 结果缓存 24h(data/model_probe.json), /api/models?fresh=1 强制重新探测。
// 用途: AI 对话模块的模型下拉(只放可输入 图片/视频/文本 的多模态对话模型)。

import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/server/db";

/**
 * 对话模型费用表(元/百万 token, 输入+输出→综合费用; 以火山方舟计费页为准, 可随时改)
 * 官方定价来源: docs.volcengine.com/docs/82379/1544106 (在线推理单价表, 分段计费取常用低档)
 * 未确认的(1.6/1.8/2.0-pro/2.1-pro)为估算, 排序参考。
 */
const CHAT_PRICE: Record<string, { in: number; out: number }> = {
  "doubao-seed-2-0-mini-260428": { in: 1.0, out: 4.0 },   // 官方
  "doubao-seed-2-0-mini-260215": { in: 1.0, out: 4.0 },   // 官方
  "doubao-seed-2-0-lite-260428": { in: 1.8, out: 9.0 },   // 官方
  "doubao-seed-2-0-lite-260215": { in: 1.8, out: 9.0 },   // 官方
  "doubao-seed-2-0-pro-260215": { in: 4, out: 12 },       // 估算
  "doubao-seed-2-0-code-preview-260215": { in: 1.6, out: 8.0 }, // 官方
  "doubao-seed-1-6-250615": { in: 2, out: 6 },            // 估算(未在文档确认)
  "doubao-seed-1-6-251015": { in: 2, out: 6 },            // 估算
  "doubao-seed-1-6-flash-250615": { in: 0.2, out: 0.75 }, // 官方(低档)
  "doubao-seed-1-6-flash-250828": { in: 0.2, out: 0.75 }, // 官方(低档)
  "doubao-seed-1-8-251228": { in: 2, out: 6 },            // 估算
  "doubao-seed-2-1-pro-260628": { in: 4, out: 12 },       // 估算
  "doubao-seed-2-1-turbo-260628": { in: 0.8, out: 8.0 },  // 官方
  "doubao-seed-character-260628": { in: 1.0, out: 12.0 }, // 官方
};
const DEFAULT_PRICE = { in: 2, out: 5 };

export interface ProbeModel {
  id: string;
  name: string;
  label: string;
  /** multimodal = 输入支持图片/视频(可看图/视频/文本); text = 仅文本输入 */
  category: "multimodal" | "text";
  /** 输入模态(诊断用) */
  input: string[];
  output: string[];
  /** 综合费用 = 输入+输出价(元/百万 token), 未知时用默认 */
  price: number;
}

let _cache: { at: number; list: ProbeModel[] } | null = null;
const TTL = 24 * 3600 * 1000;
const cachePath = (): string => path.join(dataDir(), "model_probe.json");

interface RawModel {
  id?: unknown; name?: unknown; status?: unknown; domain?: unknown;
  task_type?: unknown; modalities?: { input_modalities?: unknown; output_modalities?: unknown };
}

async function fetchArkModels(): Promise<RawModel[]> {
  const key = process.env.DOUBAO_API_KEY || "";
  const resp = await fetch("https://ark.cn-beijing.volces.com/api/v3/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`拉取模型列表失败: HTTP ${resp.status}`);
  const j = (await resp.json()) as { data?: RawModel[] };
  return j.data || [];
}

/** 候选: 未下线、非向量化、非视频生成(探测对话接口即可区分) */
function isCandidate(m: RawModel): boolean {
  const id = String(m.id || "");
  const status = String(m.status || "");
  const domain = String(m.domain || "");
  const tasks = Array.isArray(m.task_type) ? String(m.task_type.join("|")).toLowerCase() : "";
  if (!id || status === "Shutdown") return false;
  if (domain === "Embedding" || tasks.includes("embedding")) return false;
  if (domain === "VideoGeneration") return false;
  return true;
}

/** 单模型探测: 轻量对话, 返回是否可用 */
async function probeOne(model: string): Promise<boolean> {
  try {
    const key = process.env.DOUBAO_API_KEY || "";
    const resp = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) return true;
    const text = await resp.text();
    try {
      const code = String((JSON.parse(text).error?.code) || "");
      // 明确表示未开通/不存在 → 不可用; 其他(限流/欠费等)视为"未知", 也算不可用但保守
      return false;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function probeBatch(ids: string[], concurrency = 8): Promise<Set<string>> {
  const ok = new Set<string>();
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(async (id) => ((await probeOne(id)) ? id : null)));
    for (const r of results) if (r) ok.add(r);
  }
  return ok;
}

function readCache(): ProbeModel[] | null {
  try {
    const f = cachePath();
    if (!fs.existsSync(f)) return null;
    const j = JSON.parse(fs.readFileSync(f, "utf8")) as { at?: number; list?: ProbeModel[] };
    if (j.list && Array.isArray(j.list) && j.at && Date.now() - j.at < TTL) return j.list;
    return null;
  } catch {
    return null;
  }
}

function writeCache(list: ProbeModel[]): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify({ at: Date.now(), list }));
  } catch { /* ignore */ }
}

/** 已开通可用的对话模型(探测 + 24h 缓存); force = 强制重新探测 */
export async function probeChatModels(force = false): Promise<{ list: ProbeModel[]; fromCache: boolean }> {
  if (!force && _cache && Date.now() - _cache.at < TTL) return { list: _cache.list, fromCache: true };
  const cached = !force ? readCache() : null;
  if (cached) {
    _cache = { at: Date.now(), list: cached };
    return { list: cached, fromCache: true };
  }

  const raw = await fetchArkModels();
  const candidates = raw.filter(isCandidate);
  const ids = candidates.map((m) => String(m.id));
  const okIds = await probeBatch(ids);

  const list: ProbeModel[] = [];
  for (const m of candidates) {
    const id = String(m.id);
    if (!okIds.has(id)) continue;
    const input = Array.isArray(m.modalities?.input_modalities) ? (m.modalities!.input_modalities as string[]) : [];
    const output = Array.isArray(m.modalities?.output_modalities) ? (m.modalities!.output_modalities as string[]) : [];
    const hasMediaInput = input.includes("image") || input.includes("video");
    const p = CHAT_PRICE[id] || DEFAULT_PRICE;
    list.push({
      id,
      name: String(m.name || ""),
      label: String(m.name || id).replace(/[-_]/g, " "),
      category: hasMediaInput ? "multimodal" : "text",
      input,
      output,
      price: p.in + p.out,
    });
  }
  // 同名系列多个版本(如 seed-2.0-mini 有 260215/260428): 只保留最新版本, 避免下拉重复
  const byName = new Map<string, ProbeModel>();
  for (const m of list) {
    const prev = byName.get(m.name);
    // id 含日期后缀, 字典序即版本序(新版在后)
    if (!prev || m.id > prev.id) byName.set(m.name, m);
  }
  const deduped = [...byName.values()];
  // 按综合费用从低到高排序(便宜优先), 同价按名称
  deduped.sort((a, b) => a.price - b.price || a.label.localeCompare(b.label));
  _cache = { at: Date.now(), list: deduped };
  writeCache(deduped);
  return { list: deduped, fromCache: false };
}

/** 对话模块要的: 可输入图片/视频/文本 的多模态对话模型 */
export async function listChatableMediaModels(force = false): Promise<{ models: ProbeModel[]; loading: boolean }> {
  const { list, fromCache } = await probeChatModels(force);
  return { models: list.filter((m) => m.category === "multimodal"), loading: !fromCache };
}