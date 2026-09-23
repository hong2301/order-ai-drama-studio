// 剧本一致性检查 + 剧情适配: 生成前把"已配置的人物/场景/产品"与"固定提示词(剧情)"对齐
// 用 AI 对话模块当前选择的模型(settings.chat_model, 与解析同源), 输出适配后的完整生成提示词
import { chat, type ToolDef } from "@/lib/server/doubao";
import { getSetting, getApiKey } from "@/lib/server/db";
import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/server/db";

export interface ScriptMaterial {
  name: string;
  prompt: string;
  /** 关联图片(/api/uploads/... 本地路径), 生成时作为参考图 */
  images?: { name: string; url: string }[];
}

/** 本地 /api/uploads/... → data URL(适配器看参考图用; 公网 URL 原样) */
function toDataUrl(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return url.startsWith("http") ? url : null;
  const file = path.join(dataDir(), "uploads", m[1], m[2]);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  return `data:${mime[ext] || "application/octet-stream"};base64,${fs.readFileSync(file).toString("base64")}`;
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
    list.length ? list.map((c) => `- ${c.name}: ${c.prompt}${c.images?.length ? `（参考图: ${c.images.map((i) => i.name || i.url).join("、")}）` : ""}`).join("\n") : "（无）";
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
    "6. 参考图约束: 人物/场景/产品若有参考图, 必须先观看图片, 将画面细节(人物脸型发型穿着/场景光线色调/产品外观包装)尽量按图中画面写进提示词——生成结果必须贴近参考图对应对象; 图片名称(如 正面照)表示角度, 对应写角度。",
    "7. 服装与场景匹配: 人物服装/造型必须与所在场景匹配(居家→家居服、外出→外套鞋帽、办公→正装、季节/节日相应)。若场景被修改, 必须同步调整人物服装描写使其协调, 且同一人物在同一集内保持同一套造型。",
  ].join("\n");

  // 参考图列表(供模型观看)
  const refImgs: string[] = [];
  for (const list of [input.characters, input.scenes, input.products]) {
    for (const mat of list) {
      for (const img of mat.images || []) {
        const d = toDataUrl(img.url);
        if (d) refImgs.push(d);
      }
    }
  }

  const result: { value: Record<string, unknown> | null } = { value: null };
  const t0 = Date.now();
  try {
    // 适配限 40s: 豆包响应再慢也不拖住生成(超时走降级, 直接返回 null 用原文)
    const chatDone = (async () => {
      await chat(apiKey, model, [{ role: "user", content: `${instruction}\n\n${items}`, images: refImgs }], {
        tools: [ADAPT_TOOL],
        onToolCall: async (name, args) => {
          if (name === "adapt_prompt") { result.value = args; return JSON.stringify({ ok: true }); }
          return JSON.stringify({ ok: false, detail: `未知工具 ${name}` });
        },
      });
    })();
    const timeout = new Promise<void>((res) => setTimeout(res, 40000));
    await Promise.race([chatDone, timeout]);
    console.log(`[adapt] ${result.value?.prompt ? "完成" : "超时降级"}, 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s, 参考图 ${refImgs.length} 张, prompt 长度 ${String(result.value?.prompt || "").length}`);
  } catch (e) {
    console.log(`[adapt] 失败, 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(e as Error).message}`.slice(0, 200));
  }
  const p = result.value?.prompt;
  if (!p || !String(p).trim()) return null;
  const notes = Array.isArray(result.value?.notes) ? result.value.notes.map((s) => String(s)) : [];
  return { prompt: String(p).trim(), notes };
}