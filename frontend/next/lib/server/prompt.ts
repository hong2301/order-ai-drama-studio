// 提示词引擎 ★核心抽象(移植自 backend/app/services/prompt_engine.py)
// structured -- 把 人物/场景/产品/模板(故事线)/节奏 等格式化配置组装成完整 Seedance 提示词
// free       -- 用户直接粘贴/编辑整段提示词, 原样透传
import type { Beat, Character, Product, Scene, StoryTemplate, VideoRhythm } from "../../app/lib/types";

export const SERIES_SETTING = `《嘴硬家属》15秒家庭情感短剧。固定人物、固定关系、持续连载的一家人日常。
叙事原则：
- 每集只讲一件小事，前半段有轻微冲突，后半段完成关心反转；
- 产品通过放进背包、放进冰箱、放进行李箱等动作自然出现，不承担说教任务；
- 结尾强调家人关系，不直接喊购买，不宣传治疗作用，不出现吃完立即见效画面。`;

/** 人物块: 每人一行(优先用人物提示词 prompt, 否则回落旧字段组合) */
function personsBlock(characters: Character[]): string {
  return characters.map((c) => {
    const name = (c.name || "").trim();
    const prompt = (c.prompt || "").trim();
    if (name && prompt) return `${name}：${prompt}`;
    const parts: string[] = [name];
    if (c.age) parts.push(`${c.age}岁`);
    if ((c.profession || "").trim()) parts.push(c.profession.trim());
    if ((c.traits || "").trim()) parts.push(c.traits.trim());
    if ((c.look || "").trim()) parts.push(`外形：${c.look.trim()}`);
    return parts.join("、");
  }).join("\n");
}

function productBlock(product: Product, appearWay: string): string {
  const name = (product.name || "").trim();
  const prompt = (product.prompt || "").trim();
  if (prompt) return `产品：${name}。${prompt}`;
  const way = (appearWay || "").trim();
  if (way) return `产品：${name}。出现方式：${way}。画面中保留2至3秒清晰露出产品。`;
  return `产品：${name}。通过放进背包/冰箱/行李箱等自然动作出现，画面中保留2至3秒清晰露出。`;
}

function sceneBlock(scene: Scene): string {
  const name = (scene.name || "").trim();
  const prompt = (scene.prompt || "").trim();
  if (prompt) return `${name}。${prompt}`;
  const loc = (scene.location || "").trim();
  const d = (scene.desc || "").trim();
  const at = (scene.atmosphere || "").trim();
  let line = [name, loc ? `(${loc})` : "", d].filter(Boolean).join(" ");
  if (at) line += `，氛围：${at}`;
  return line;
}

/** 模板块: 故事线 + 冲突 + 分秒节拍 */
function templateBlock(template: StoryTemplate): string {
  const lines: string[] = [];
  const sl = (template.story_line || "").trim();
  if (sl) lines.push(`故事线：${sl}`);
  const rh = (template.relation_hint || "").trim();
  if (rh) lines.push(`主要人物关系：${rh}`);
  const cf = (template.conflict || "").trim();
  if (cf) lines.push(`核心冲突：${cf}`);
  const beats: Beat[] = template.beats || [];
  if (beats.length) {
    lines.push("叙事节拍：");
    for (const b of beats) {
      const seg = `第${b.start ?? 0}至${b.end ?? 0}秒`;
      const beat = (b.beat || "").trim();
      const content = (b.content || "").trim();
      if (beat && content) lines.push(`  ${seg}（${beat}）：${content}`);
      else if (content) lines.push(`  ${seg}：${content}`);
    }
  }
  return lines.join("\n");
}

function outputSpec(opts: { duration?: number; resolution?: string }): string {
  const spec = [`竖屏9:16短视频，总时长约${opts.duration ?? 15}秒。`];
  if (opts.resolution) spec.push(`分辨率${opts.resolution}。`);
  spec.push("电影级质感，生活流家庭短剧，克制叙事，温暖反转，浅景深，镜头平稳缓慢，人物表情自然，无生硬广告感。");
  return spec.join(" ");
}

export interface StructuredConfig {
  characters?: Character[];
  scene?: Scene | null;
  product?: Product | null;
  appear_way?: string;
  template?: StoryTemplate | null;
  rhythm?: VideoRhythm | null;
  duration?: number;
  resolution?: string;
  ratio?: string;
}

/** 结构化配置 -> 完整提示词 */
export function buildStructuredPrompt(cfg: StructuredConfig): string {
  const blocks: string[] = [SERIES_SETTING];
  const characters = cfg.characters || [];
  if (characters.length) blocks.push("人物设定：\n" + personsBlock(characters));
  if (cfg.scene) blocks.push("场景设定：" + sceneBlock(cfg.scene));
  if (cfg.product) blocks.push(productBlock(cfg.product, cfg.appear_way || ""));
  if (cfg.template) blocks.push(templateBlock(cfg.template));
  const rhythm = cfg.rhythm;
  if (rhythm && (rhythm.segments || []).length) {
    const lines = [`视频节奏（${rhythm.name || ""}，总长${rhythm.duration ?? 15}秒）：`];
    for (const s of rhythm.segments || []) {
      lines.push(`  第${s.start ?? 0}至${s.end ?? 0}秒：${s.purpose || ""}`);
    }
    blocks.push(lines.join("\n"));
  }
  blocks.push(outputSpec(cfg));
  return blocks.join("\n\n");
}

/** 自由模式: 用户已给出完整提示词, 原样返回 */
export function buildFreePrompt(raw: string): string {
  return (raw || "").trim();
}