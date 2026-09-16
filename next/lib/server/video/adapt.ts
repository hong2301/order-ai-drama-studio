// 剧本一致性检查 + 剧情适配: 生成前把"已配置的人物/场景/产品"与"固定提示词(剧情)"对齐
// 用 AI 对话模块当前选择的模型(settings.chat_model, 与解析同源), 输出适配后的完整生成提示词
import { chat, type ToolDef } from "@/lib/server/doubao";
import { getSetting, getApiKey } from "@/lib/server/db";

export interface ScriptMaterial {
  name: string;
  prompt: string;
}

/** 物料指纹: 按名称排序的 name|prompt 序列——三库内容(勾选/提示词)变化则指纹变化 */
export function materialsFp(characters: ScriptMaterial[], scenes: ScriptMaterial[], products: ScriptMaterial[]): string {
  const norm = (list: ScriptMaterial[]): string[] =>
    [...list].sort((a, b) => a.name.localeCompare(b.name)).map((x) => `${x.name}|${x.prompt}`);
  return JSON.stringify({ c: norm(characters), s: norm(scenes), p: norm(products) });
}

export interface AdaptInput {
  content: string;
  characters: ScriptMaterial[];
  scenes: ScriptMaterial[];
  products: ScriptMaterial[];
  /** 视频配置简述, 如 "1080P · 9:16 · 15秒" */
  config?: string;
}

const ADAPT_TOOL: ToolDef = {
  name: "adapt_prompt",
  description: "按已配置的人物/场景/产品，输出与剧情一致的适配后视频生成提示词",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "适配后的完整视频生成提示词(剧情与配置物料一致, 面向视频生成模型的画面描述)" },
      notes: { type: "array", items: { type: "string" }, description: "适配说明, 如 新增人物-小宇 / 移除未配置场景-超市" },
    },
    required: ["prompt"],
  },
};

/** 一致性检查+适配: 配置与剧情有出入则返回适配后提示词; 无出入或失败返回 null(调用方用原提示词) */
export async function adaptPrompt(input: AdaptInput): Promise<{ prompt: string; notes: string[] } | null> {
  // 没有任何已配置物料 → 无需适配
  if (!input.characters.length && !input.scenes.length && !input.products.length) return null;
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  // 与 AI 对话模块当前选择的模型同步(无则用环境变量默认)
  const model = await getSetting("chat_model", process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428");

  const fmt = (list: ScriptMaterial[]): string =>
    list.length ? list.map((c) => `- ${c.name}: ${c.prompt}`).join("\n") : "（无）";
  const items = [
    "【剧本内容(固定提示词)】",
    input.content,
    "",
    "【已配置人物】",
    fmt(input.characters),
    "",
    "【已配置场景】",
    fmt(input.scenes),
    "",
    "【已配置产品】",
    fmt(input.products),
    "",
    `【视频配置】${input.config || "由控制台设置"}`,
  ].join("\n");

  const instruction = [
    "你是短视频剧本适配助手。有一份固定提示词(剧情)和一组已配置的人物/场景/产品(视频生成时用)。",
    "请做一致性检查, 并调用 adapt_prompt 输出适配后的完整提示词:",
    "1. 保持剧情主线、节奏与风格不变。以「已配置」为准: 剧本里出现的人物/场景/产品, 若在配置里存在则改用配置中的描述; 配置里没有的, 从剧情中删掉或改写成配置内元素(缺人物合并戏份、缺场景替换为已配置场景、缺产品去除相关内容)。",
    "2. 配置比剧情多的 人物/场景/产品 → 自然地补进剧情(一笔带过, 不喧宾夺主)。",
    "3. 严禁引入配置之外的新 人物/场景/产品。",
    "4. 输出面向视频生成模型的完整画面描述(人物外貌动作、场景光线氛围、镜头), 中文, 包含视频配置。",
    "5. 对白台词以「人物台词：xxx」直接写入提示词(视频模型会输出语音与口型); 旁白用「旁白：xxx」。台词短句(≤14字), 配合动作描写。",
  ].join("\n");

  const result: { value: Record<string, unknown> | null } = { value: null };
  try {
    await chat(apiKey, model, [{ role: "user", content: `${instruction}\n\n${items}` }], {
      tools: [ADAPT_TOOL],
      onToolCall: async (name, args) => {
        if (name === "adapt_prompt") { result.value = args; return JSON.stringify({ ok: true }); }
        return JSON.stringify({ ok: false, detail: `未知工具 ${name}` });
      },
    });
  } catch { /* 适配失败不阻断生成 */ }
  const p = result.value?.prompt;
  if (!p || !String(p).trim()) return null;
  const notes = Array.isArray(result.value?.notes) ? result.value.notes.map((s) => String(s)) : [];
  return { prompt: String(p).trim(), notes };
}