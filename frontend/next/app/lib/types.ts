// 后端数据结构定义(与 backend/app 对应)
export interface AiConfig {
  id: number;
  name: string;
  provider: string;
  api_key: string;
  model_id: string;
  kind: "video" | "chat" | "image";
  capability: { durations?: number[]; resolutions?: string[]; ratios?: string[]; [k: string]: unknown };
  cost_note: string;
  desc: string;
  enabled: boolean;
  sort_order: number;
}

export interface Character {
  id: number;
  name: string;
  family_role: string;
  age: number;
  profession: string;
  traits: string;
  look: string;
  prompt?: string;
  photos?: string[];
  active: boolean;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  fit_persons: string[];
  appear_ways: string[];
  desc: string;
  prompt?: string;
  active: boolean;
}

export interface Scene {
  id: number;
  name: string;
  location: string;
  desc: string;
  atmosphere: string;
  timing: string;
  prompt?: string;
  active: boolean;
}

export interface Beat {
  start: number;
  end: number;
  beat?: string;
  content?: string;
  purpose?: string;
}

export interface StoryTemplate {
  id: number;
  name: string;
  story_line: string;
  relation_hint: string;
  conflict: string;
  beats: Beat[];
  example: string;
  seed_prompt: string;
  active: boolean;
}

export interface VideoRhythm {
  id: number;
  name: string;
  duration: number;
  desc: string;
  segments: Beat[];
  active: boolean;
}

export type GenerationStatus = "draft" | "queued" | "running" | "succeeded" | "failed" | "downloaded";

export interface Generation {
  id: number;
  mode: "structured" | "free";
  title: string;
  prompt: string;
  model_id: string;
  status: GenerationStatus;
  task_id: string;
  video_url: string;
  local_path: string;
  duration: number;
  resolution: string;
  ratio: string;
  seed: number;
  extra: {
    characters: string[];
    scene: string;
    product: string;
    appear_way: string;
    template: string;
    rhythm: string;
    [k: string]: unknown;
  };
  error: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationCreate {
  mode: "structured" | "free";
  title: string;
  prompt?: string;
  prompt_override?: string; // 结构化模式下手动改写提示词(可选)
  character_ids: number[];
  product_id?: number;
  appear_way: string;
  scene_id?: number;
  template_id?: number;
  rhythm_id?: number;
  duration: number;
  resolution: string;
  ratio: string;
  seed: number;
}