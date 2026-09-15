// 视频生成模型注册表 —— 声明式配置
// 接入新模型/新商家: 在这里加一行 + 确保 provider 已注册即可, 前端/API 自动识别
import type { VideoModelDef, VideoProvider, VideoInputMode } from "./types";
import { doubaoVideo } from "./providers/doubao";

/** 商家 provider 注册(以后加 kling/runway/jimeng 等在这里 +types+providers 目录) */
export const PROVIDERS: Record<string, VideoProvider> = {
  doubao: doubaoVideo,
};

/**
 * 模型定义。
 * status 依据: 账号实测(ModelNotOpen=inactive) + 官方生命周期(Retiring/Shutdown)。
 * 已在方舟控制台开通新模型后, 把对应条目的 status 改 active 即可(或提交任务时动态识别)。
 */
export const MODELS: VideoModelDef[] = [
  // ---------- 火山方舟 · 豆包 Seedance(已验证可用) ----------
  {
    key: "doubao-seedance-1-0-pro",
    provider: "doubao",
    model: "doubao-seedance-1-0-pro-250528",
    name: "Seedance 1.0 Pro",
    modes: ["text", "image"] as VideoInputMode[],
    status: "active",
    note: "文生视频 + 图生视频(首帧)",
    presets: { resolutions: ["480P", "720P", "1080P"], ratios: ["9:16", "16:9", "1:1"], duration: true },
    // 官方: 输入 7.5 / 输出 15 元每百万token; 按 720P·16:9·25fps 折算(每秒token=1280*720*25/1024=22500) ≈ 0.34 元/秒
    pricePerSecond: 0.34,
  },
  {
    key: "doubao-seedance-1-0-pro-fast",
    provider: "doubao",
    model: "doubao-seedance-1-0-pro-fast-251015",
    name: "Seedance 1.0 Pro Fast",
    modes: ["text", "image"] as VideoInputMode[],
    status: "active",
    note: "文生视频 + 图生视频, 生成更快",
    presets: { resolutions: ["480P", "720P", "1080P"], ratios: ["9:16", "16:9", "1:1"], duration: true },
    // 官方: 输入 2.1 / 输出 4.2 元每百万token; 720P·16:9·25fps 折算 ≈ 0.09 元/秒
    pricePerSecond: 0.09,
  },

  // ---------- 火山方舟 · 豆包 Seedance(账号未开通/待控制台激活) ----------
  {
    key: "doubao-seedance-2-0",
    provider: "doubao",
    model: "doubao-seedance-2-0-260128",
    name: "Seedance 2.0",
    modes: ["text", "image"] as VideoInputMode[],
    status: "inactive",
    note: "未开通: 请到火山方舟控制台开启后改 registry 状态",
  },
  {
    key: "doubao-seedance-2-0-fast",
    provider: "doubao",
    model: "doubao-seedance-2-0-fast-260128",
    name: "Seedance 2.0 Fast",
    modes: ["text", "image"] as VideoInputMode[],
    status: "inactive",
    note: "未开通: 请到火山方舟控制台开启后改 registry 状态",
  },
  {
    key: "doubao-seedance-2-0-mini",
    provider: "doubao",
    model: "doubao-seedance-2-0-mini-260615",
    name: "Seedance 2.0 Mini",
    modes: ["text", "image"] as VideoInputMode[],
    status: "inactive",
    note: "未开通: 请到火山方舟控制台开启后改 registry 状态",
  },
  {
    key: "doubao-seedance-2-5",
    provider: "doubao",
    model: "doubao-seedance-2-5-260628",
    name: "Seedance 2.5(支持视频编辑/扩展)",
    modes: ["text", "image"] as VideoInputMode[],
    status: "inactive",
    note: "最新版, 未开通: 请到火山方舟控制台开启后改 registry 状态",
  },

  // ---------- 快下线/已移除(展示但禁用) ----------
  {
    key: "doubao-seedance-1-0-lite-t2v",
    provider: "doubao",
    model: "doubao-seedance-1-0-lite-t2v-250428",
    name: "Seedance 1.0 Lite(文生)",
    modes: ["text"] as VideoInputMode[],
    status: "inactive",
    note: "已下线",
  },
  {
    key: "doubao-seedance-1-5-pro",
    provider: "doubao",
    model: "doubao-seedance-1-5-pro-251215",
    name: "Seedance 1.5 Pro(带音频)",
    modes: ["text", "image"] as VideoInputMode[],
    status: "inactive",
    note: "已下线",
  },
];

/** 前端可用的全部模型定义(含禁用) */
export function listModelDefs(): VideoModelDef[] {
  return MODELS;
}

/** 可提交任务的模型(active / retiring) */
export function activeModelDefs(): VideoModelDef[] {
  return MODELS.filter((m) => m.status === "active" || m.status === "retiring");
}

export function getModelDef(key: string): VideoModelDef | undefined {
  return MODELS.find((m) => m.key === key);
}

export function getProvider(id: string): VideoProvider | undefined {
  return PROVIDERS[id];
}