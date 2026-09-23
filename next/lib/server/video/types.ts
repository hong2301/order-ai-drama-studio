// 视频生成 — 通用类型(与具体商家解耦)
// 新增商家/模型只需: 1) 实现 VideoProvider  2) 在 registry 里注册模型定义

/** 任务状态(统一映射自各商家) */
export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** 生成模式: 纯文本 / 图生视频(单参考图) / 首尾帧 */
export type VideoInputMode = "text" | "image" | "first_last_frame";

export interface VideoModelDef {
  /** 系统内唯一 key(下拉/API 用), 如 doubao-seedance-1-0-pro */
  key: string;
  /** 商家 provider id, 如 "doubao" */
  provider: string;
  /** 商家真实模型 ID */
  model: string;
  /** 展示名 */
  name: string;
  /** 支持的模式 */
  modes: VideoInputMode[];
  /** active=可用; inactive=账号未开通/已下线(前端置灰); retiring=快下线 */
  status: "active" | "retiring" | "inactive";
  /** 提示信息(为何不可用/如何开通) */
  note?: string;
  /** 能力开关: 该模型支持哪些控制参数(不在列表里的控件前端禁用) */
  presets?: {
    resolutions?: string[];
    ratios?: string[];
    /** 是否支持自定义时长(秒); false/缺省 = 模型固定时长 */
    duration?: boolean;
    /** 时长上限(秒); 超出直接报错, 不静默降级 */
    durationMax?: number;
  };
  /** 每秒费用(元/秒, 估算; 以方舟计费页为准)。时长可设, 总费用 ≈ 秒数 × 每秒价 */
  pricePerSecond?: number;
}

/** provider 提交任务时的统一请求 */
export interface VideoSubmitRequest {
  model: string;
  prompt: string;
  /** 单图输入(图生视频/首帧), 可为 /api/uploads 本地路径或公网 URL(provider 负责转 data URL) */
  imageUrl?: string | null;
  /** 参考图(文生 t2v 锚定形象: 人物/场景/产品), 与 imageUrl 二选一使用 */
  referenceImages?: { name?: string; url: string }[];
  /** 尾帧(仅 first_last_frame 模式) */
  lastFrameUrl?: string | null;
  /** 分辨率(需模型 presets.resolutions 支持) */
  resolution?: string;
  /** 画面比例(需模型 presets.ratios 支持) */
  ratio?: string;
  /** 时长秒数(上限由模型接口决定: 超出时由接口报错, provider 取接口给的上限重试) */
  duration?: number;
}

/** provider 查询返回的统一任务快照 */
export interface VideoProviderTask {
  /** 商家侧任务 id(如 cgt-xxx) */
  id: string;
  status: VideoTaskStatus;
  videoUrl?: string | null;
  error?: string | null;
  /** 实际采用的时长(接口按上限回调时有值) */
  durationUsed?: number;
  /** 原请求时长超出接口上限时, 记录原值供提示 */
  durationAdjustedFrom?: number;
}

/** 商家适配器接口 —— 新商家实现这一个接口即可接入 */
export interface VideoProvider {
  id: string;
  name: string;
  /** 创建生成任务, 返回商家任务 id(可能已成功/失败, 以 status 为准) */
  submit(req: VideoSubmitRequest): Promise<VideoProviderTask>;
  /** 按商家任务 id 查询最新状态 */
  get(taskId: string): Promise<VideoProviderTask>;
}

/** 落库的任务记录 */
export interface VideoTask {
  id: string;            // 商家任务 id
  provider: string;
  modelKey: string;
  model: string;
  scriptName?: string;   // 关联剧本名(视频库展示)
  prompt: string;
  resolution?: string;
  ratio?: string;
  duration?: string;
  /** 生成链路阶段(占位期): adapting=整理提示词 / submitting=提交方舟; 真实任务基本为空 */
  stage?: string;
  /** 原请求时长超出模型接口上限, 已按接口返回的上限下调(前端提示用) */
  durationAdjustedFrom?: number;
  imageUrl?: string | null;
  status: VideoTaskStatus;
  videoUrl?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}