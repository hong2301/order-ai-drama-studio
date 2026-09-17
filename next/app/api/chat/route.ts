// AI 对话: POST /api/chat {message, images?, videos?, messages?, model?}
// 每次会话注入系统上下文(SYSTEM_PROMPT); 工具: 剧本/资料库读写 + 视频提取剧本 + 直接发起视频生成(操控控制台)
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { chat, DoubaoError, type ChatMsg, type ToolDef } from "@/lib/server/doubao";
import { dataDir, getDb, persist, getApiKey } from "@/lib/server/db";
import { SYSTEM_PROMPT, SCRIPT_SKILL, needScriptSkill } from "@/lib/server/chatSystem";
import { DATA_TOOLS, execDataTool, DATA_TOOL_WRITES, registerChatImages } from "@/lib/server/chatDataTools";
import { createVideoTask, ensureVideoTables } from "@/lib/server/video";
import { upsertLibraryRecord, type LibraryTable } from "@/lib/server/library";

type Body = { message?: string; images?: string[]; videos?: string[]; messages?: ChatMsg[]; model?: string };

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp",
};
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4",
};

/** /api/uploads/<folder>/<name> -> 本地文件绝对路径(带扩展名校验) */
function uploadFilePath(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  const file = path.join(dataDir(), "uploads", path.basename(m[1]), path.basename(m[2]));
  return fs.existsSync(file) ? file : null;
}

/** 图片附件 -> data URL(≤10MB) */
function localImageToDataUrl(url: string): string | null {
  const file = uploadFilePath(url);
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!MIME[ext]) return null;
  if (fs.statSync(file).size > 10 * 1024 * 1024) return null;
  return `data:${MIME[ext]};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** 视频附件 -> data URL(≤30MB, 供模型读视频) */
function localVideoToDataUrl(url: string): string | null {
  const file = uploadFilePath(url);
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!VIDEO_MIME[ext]) return null;
  if (fs.statSync(file).size > 30 * 1024 * 1024) return null;
  return `data:${VIDEO_MIME[ext]};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** 文本附件(txt/docx) -> 读取内容, 注入到消息里让 AI 可读; 其他返回 null */
async function attachTextOf(url: string): Promise<{ name: string; text: string } | null> {
  const file = uploadFilePath(url);
  if (!file) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  let text = "";
  try {
    if (ext === "docx") {
      text = (await mammoth.extractRawText({ buffer: fs.readFileSync(file) })).value || "";
    } else if (ext === "txt" || ext === "md") {
      text = fs.readFileSync(file, "utf8");
    } else {
      return null;
    }
  } catch { return null; }
  if (!text.trim()) return null;
  return { name: path.basename(file), text };
}

// ---------- 剧本库工具 ----------
/** 把内容写入 scripts 表(与 POST /api/scripts 相同逻辑) */
async function execAddScript(args: Record<string, unknown>): Promise<string> {
  const content = String(args.content ?? "").trim();
  if (!content) return JSON.stringify({ ok: false, detail: "内容为空" });
  const filePath = String(args.file_path ?? "").trim();
  const name = String(args.name ?? "").trim() || content.split(/\r?\n/)[0].trim().slice(0, 30) || "未命名";
  const now = new Date().toISOString();
  try {
    const db = await getDb();
    db.run(
      "INSERT INTO scripts(name, file_path, content, created_at, updated_at) VALUES(?,?,?,?,?)",
      [name, filePath, content, now, now],
    );
    const id = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0);
    await persist();
    // 解析改为**后台异步**(不阻塞本次回复): 解析要再调一次 AI(几十秒), 同步等会把整个请求拖到超时/被中断
    void (async () => {
      try {
        const { parseScript } = await import("@/lib/server/scriptParse");
        await parseScript(id);
      } catch { /* 解析失败不影响入库 */ }
    })();
    return JSON.stringify({ ok: true, id, name, detail: "已保存到剧本库(人物/场景/产品解析在后台进行)" });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: (e as Error).message });
  }
}

const ADD_SCRIPT_TOOL: ToolDef = {
  name: "add_script",
  description: "将剧本内容/提示词保存到剧本库(**需传完整 content**)。用户给了一段新内容要求保存时才用; 如果是保存**你上一条回复里刚输出的剧本**, 用 save_last_script 更快。**仅在用户明确要求「加入剧本库/保存剧本/记录到剧本库」时调用**; 只读文件内容、回答关于文件的问题时绝不要调用(用 read_file)。内容来自附件文件时须带 file_path。",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "剧本名称(可选, 不填则取内容首行)" },
      content: { type: "string", description: "剧本完整内容或提示词" },
      file_path: { type: "string", description: "内容来自用户附件时填其在 data 目录下的路径, 如 data/uploads/chat/xxx.docx" },
    },
    required: ["content"],
  },
};

/** 读取用户附件文件内容(仅文本文件), 不写入剧本库 */
async function execReadFile(args: Record<string, unknown>): Promise<string> {
  const raw = String(args.path ?? "").trim();
  const m = /^data\/uploads\/(.+)$/.exec(raw);
  if (!m) return JSON.stringify({ ok: false, detail: "path 应为 data/uploads/... 格式" });
  const file = path.join(dataDir(), "uploads", m[1]);
  if (!fs.existsSync(file)) return JSON.stringify({ ok: false, detail: "文件不存在" });
  const ext = path.extname(file).slice(1).toLowerCase();
  let text = "";
  try {
    if (ext === "docx") text = (await mammoth.extractRawText({ buffer: fs.readFileSync(file) })).value || "";
    else if (ext === "txt" || ext === "md") text = fs.readFileSync(file, "utf8");
    else return JSON.stringify({ ok: false, detail: "该文件类型无法读取文本" });
  } catch {
    return JSON.stringify({ ok: false, detail: "读取文件失败" });
  }
  if (!text.trim()) return JSON.stringify({ ok: false, detail: "文件无文本内容" });
  return text.slice(0, 20000);
}

/** 资料库(人物/场景/产品)写库工具 — 与 add_script 同级 */
const LIB_META: Record<string, { table: string; typeName: string; label: string }> = {
  add_character: { table: "characters", typeName: "人物", label: "身份" },
  add_scene:     { table: "scenes",     typeName: "场景", label: "类型" },
  add_product:   { table: "products",   typeName: "产品", label: "品类" },
};

function buildLibTool(name: string): ToolDef {
  const m = LIB_META[name];
  // 只有人物库有身份标签字段; 场景/产品库只有 名称/提示词/图片(界面也不展示标签)
  const withIdentity = name === "add_character";
  const properties: Record<string, unknown> = {
    name: { type: "string", description: `${m.typeName}名称` },
    prompt: { type: "string", description: `${m.typeName}提示词/描述(纯画面描述), 从用户内容中整理` },
  };
  if (withIdentity) {
    properties.identity = { type: "array", items: { type: "string" }, description: `${m.label}标签数组(如人物为 主角/婆婆)` };
  }
  const fields = withIdentity ? `名称/${m.label}标签/提示词/图片` : `名称/提示词/图片`;
  return {
    name,
    description: `把用户提供的内容保存为一条${m.typeName}记录到资料库(字段: ${fields})。**仅在用户明确要求「加入${m.typeName}库/保存到${m.typeName}库/记录${m.typeName}」时调用**；只是谈论/描述时绝不要调用。内容来自附件文件时可先 read_file 读取再整理。若本轮用户带了图片附件, 系统会自动把图片登记进图库并与该记录关联(无需你传图片参数)。${withIdentity ? "" : `${m.typeName}库没有「${m.label}」字段, 不要在回复里编造或提及${m.label}。`}`,
    parameters: { type: "object", properties, required: ["name", "prompt"] },
  };
}

const LIB_TOOLS: ToolDef[] = Object.keys(LIB_META).map((n) => buildLibTool(n));

const SAVE_LAST_TOOL: ToolDef = {
  name: "save_last_script",
  description: "把**你上一条回复里刚输出的剧本**保存进剧本库——**不需要传 content**(系统自动取你上一条回复), 比 add_script 快得多。用户说「保存/加入剧本库/存起来/记录一下」而你刚刚输出过完整剧本时, 优先用这个。若用户给的是新内容、或你上一条不是完整剧本, 才用 add_script。",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "剧本名称(可选, 不传则取内容首行)" } },
  },
};

/** 保存「上一条回复中的剧本」(轻量: 不用模型重写全文, 避免请求超时) */
async function execSaveLastScript(args: Record<string, unknown>, lastAssistant: string): Promise<string> {
  const content = (lastAssistant || "").trim();
  if (!content) return JSON.stringify({ ok: false, detail: "取不到上一条回复内容, 请改用 add_script 并传入 content" });
  return execAddScript({ content, name: args.name });
}

// ---------- 工具按需装载: 系统提示词已给"工具索引", 完整定义仅在用户表达明确意图时携带, 日常对话零工具(响应最快) ----------
/** 按用户最新消息意图装载工具组(读附件在"有文本附件"时自动带上) */
function pickToolsByIntent(msg: string, hasTextAttach: boolean): ToolDef[] {
  const byDataName = (names: string[]): ToolDef[] => DATA_TOOLS.filter((t) => names.includes(t.name));
  // 剧本组: 写/存/查/改/删/提取剧本
  const groupScript: ToolDef[] = [SAVE_LAST_TOOL, TRANSFORM_TOOL, ADD_SCRIPT_TOOL, VIDEO_TO_SCRIPT_TOOL, ...byDataName(["query_script", "update_script", "delete_script"])];
  // 资料库组: 人物/场景/产品 增查改删(场景产品无身份标签)
  const groupLib: ToolDef[] = [...LIB_TOOLS, ...byDataName(["query_library", "update_library", "delete_library"])];
  // 视频组: 直接生成 + 模型可用性探测
  const groupVideo: ToolDef[] = [CREATE_VIDEO_TOOL, ...byDataName(["query_video_models"])];

  const tools: ToolDef[] = [];
  const m = msg || "";
  if (/剧本|分镜|写一集|写一段|成剧本|提取剧本|保存到剧本库|加入剧本库|删.*剧本|改.*剧本|查.*剧本|哪些剧本|几集/.test(m)) tools.push(...groupScript);
  if (/人物库|场景库|产品库|资料库|加入.*库|存到.*库|保存.*(人物|场景|产品)|删.*(人物|场景|产品)|改.*(人物|场景|产品)|查.*(人物库|场景库|产品库)/.test(m)) tools.push(...groupLib);
  if (/生成视频|做一条|做一段|做条|开始生成|视频生成|视频模型|哪个模型|开通|拍个|制作视频|生成一条/.test(m)) tools.push(...groupVideo);
  if (hasTextAttach) tools.push(READ_FILE_TOOL);
  return tools;
}

/** 写入资料库表(去重合并: 同名同提示词/同名 → 合并身份) */
async function execLibAdd(table: LibraryTable, args: Record<string, unknown>, imageIds: number[] = []): Promise<string> {
  const name = String(args.name ?? "").trim();
  const prompt = String(args.prompt ?? "").trim();
  if (!name) return JSON.stringify({ ok: false, detail: "名称不能为空" });
  if (!prompt) return JSON.stringify({ ok: false, detail: "提示词不能为空" });
  // 仅人物库有身份标签字段; 场景/产品库忽略(界面不展示该字段)
  const identity = table === "characters" && Array.isArray(args.identity)
    ? (args.identity as unknown[]).map(String)
    : [];
  try {
    const r = await upsertLibraryRecord(table, { name, identity, prompt, image_ids: imageIds });
    return JSON.stringify({ ok: true, id: r.id, merged: r.merged, name, images: imageIds.length });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: (e as Error).message });
  }
}

const READ_FILE_TOOL: ToolDef = {
  name: "read_file",
  description: "读取用户上传的附件文件(txt/docx)内容。用户要求「看一下文件/读文件/文件里写了什么/帮我看这个文件」时调用。注意: 读取内容不等于保存, 只有用户明确要求加入剧本库时才用 add_script。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "附件在 data 目录下的路径, 如 data/uploads/chat/xxx.txt" },
    },
    required: ["path"],
  },
};

// ---------- 整理剧本 / 视频提取剧本 / 直接生成视频(操控控制台) ----------
const TRANSFORM_TOOL: ToolDef = {
  name: "transform_script",
  description: "用户提供一大段想法/提示词并要求「整理成剧本/写一集剧本/生成剧本」时调用: 先把内容整理成符合规范的完整单集剧本(视频配置/人物/场景/产品/主剧情/各时间段内容/细节), 再保存进剧本库。",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "整理后的完整剧本文本(按剧本输出格式的 Markdown)" },
      name: { type: "string", description: "剧本名称(可选, 不填取内容首行)" },
    },
    required: ["content"],
  },
};

const VIDEO_TO_SCRIPT_TOOL: ToolDef = {
  name: "video_to_script",
  description: "用户上传了视频并明确要求「提取为剧本/转成剧本/根据视频写剧本」时调用: 观看视频内容, 先生成【画面提示词】+ 单集剧本初稿(按剧本规范), **只输出初稿不保存数据库**; 等用户确认后, 再按用户要求用 add_script 保存入库。注意: 只有用户明确说要把视频转成剧本时才调用。",
  parameters: {
    type: "object",
    properties: {
      video_url: { type: "string", description: "视频附件地址, 如 /api/uploads/chat/xxx.mp4" },
      name: { type: "string", description: "剧目名称(可选)" },
    },
    required: ["video_url"],
  },
};

const CREATE_VIDEO_TOOL: ToolDef = {
  name: "create_video",
  description: "直接发起视频生成(等同于操控控制台的开始生成)。用户要求「生成视频/做一条视频/开始生成」且参数齐备时调用。生成异步进行, 成功后视频自动进视频库。",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "画面描述提示词(可含人物/场景/产品描述与镜头细节)" },
      model_key: { type: "string", description: "视频模型 key, 默认 doubao-seedance-1-0-pro-fast" },
      resolution: { type: "string", description: "分辨率 480P/720P/1080P, 默认 480P" },
      ratio: { type: "string", description: "画面比例 9:16/16:9/1:1, 默认 9:16" },
      duration: { type: "number", description: "时长秒数, 默认 10(上限以模型接口为准: 超出时会按接口返回的上限自动下调, 并在结果里告知你该向用户说明)" },
    },
    required: ["prompt"],
  },
};

/** 直接创建视频生成任务(模型能力/时长上限由 createVideoTask 校验) */
async function execCreateVideo(args: Record<string, unknown>): Promise<string> {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) return JSON.stringify({ ok: false, detail: "提示词不能为空" });
  try {
    await ensureVideoTables();
    const task = await createVideoTask({
      modelKey: String(args.model_key || "doubao-seedance-1-0-pro-fast"),
      prompt,
      resolution: String(args.resolution || "480P"),
      ratio: String(args.ratio || "9:16"),
      duration: Number(args.duration) || 10,
    });
    return JSON.stringify({
      ok: true,
      task_id: task.id,
      status: task.status,
      duration: task.duration,
      message: `${task.durationAdjustedFrom ? `时长 ${task.durationAdjustedFrom} 秒超出该模型接口上限, 已按接口返回的上限调整为 ${task.duration} 秒(请向用户说明); ` : ""}视频任务已提交, 生成完成会自动进视频库`,
    });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: (e as Error).message });
  }
}

/** 视频 → 画面提示词 + 单集剧本初稿(不保存; 用户确认后再由 add_script 入库) */
async function execVideoToScript(apiKey: string, modelId: string, args: Record<string, unknown>): Promise<string> {
  const videoDataUrl = localVideoToDataUrl(String(args.video_url || ""));
  if (!videoDataUrl) return JSON.stringify({ ok: false, detail: "视频不存在或格式不支持(mp4/webm/mov, ≤30MB)" });
  const instruction = [
    "请观看这段视频, 提取其中的剧情内容, 按下面顺序输出(不要省略):",
    "1. 【画面提示词】一段可直接用于视频模型生成的画面描述(人物/场景/镜头/光线/动作, 200字内)",
    "2. 一集完整剧本(Markdown), 结构固定为:",
    "   - 标题(系列名+集数+点题)",
    "   - 视频配置(表格: 生成模型/分辨率/画面比例/时长/关键词, 分辨率默认480P)",
    "   - 人物(表格: 名称/身份标签/提示词-纯画面描述)",
    "   - 场景(表格: 名称/描述提示词)",
    "   - 产品(表格: 名称/描述提示词)",
    "   - 主剧情(两三句)",
    "   - 【单集结构·分镜】两列表格写满: | 时间 | 画面与对白 | , 按3-4秒一段切分, 每段写清 地点+肢体动作+对白(人物台词:”xxx“)+镜头提示(括号内)",
    "   - 剧情细节与执行要点",
    "要求: 人物/场景/产品贴合视频实际内容; 分镜具体到每个动作的起止; 对白口语短句。",
    "**只输出提示词与剧本初稿, 绝对不要保存到任何数据库** —— 用户确认后再说保存的事。",
  ].join("\n");
  try {
    const scriptText = await chat(apiKey, modelId, [{ role: "user", content: instruction, videos: [videoDataUrl] }]);
    if (!scriptText.trim()) return JSON.stringify({ ok: false, detail: "未能从视频提取出内容" });
    return JSON.stringify({ ok: true, draft: scriptText, detail: "已生成画面提示词与剧本初稿(未保存); 用户确认后可用 add_script 保存入库" });
  } catch (e) {
    return JSON.stringify({ ok: false, detail: `提取失败: ${(e as Error).message}` });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: Body = {};
  try { b = (await req.json()) as Body; } catch { /* ignore */ }
  const message = (b.message || "").trim();
  if (!message) return Response.json({ detail: "消息为空" }, { status: 400 });

  // ---------- 附件: 图片 -> data URL; txt/docx -> 文本注入当前消息(附带 data 路径) ----------
  const images: string[] = [];
  const chatImageUrls: string[] = []; // 本轮图片附件原始地址(供 AI 写库时自动转图库关联)
  const videos: string[] = []; // 视频附件(供模型读视频)
  let attachText = "";
  const mediaHints: string[] = []; // 图片/视频附件路径提示(供 AI 引用: video_to_script/create_video 的 url 参数)
  const attachFiles: { name: string; path: string }[] = []; // txt/docx 附件(供 add_script 兜底 file_path)
  for (const u of (b.images || []).slice(0, 9)) {
    const img = localImageToDataUrl(u);
    if (img) { images.push(img); chatImageUrls.push(u); mediaHints.push(`图片 ${u}`); continue; }
    const vid = localVideoToDataUrl(u);
    if (vid) { videos.push(vid); mediaHints.push(`视频 ${u}`); continue; }
    const at = await attachTextOf(u);
    if (at) {
      const dataPath = `data${u.slice(4)}`; // /api/uploads/... -> data/uploads/...
      attachFiles.push({ name: at.name, path: dataPath });
      attachText += `\n\n[附件文件 ${dataPath} 内容]\n${at.text}\n[/附件]`;
    }
  }
  const mediaHint = mediaHints.length ? `\n\n[对话附件路径] ${mediaHints.join("；")} —— 需要时用这些地址作为工具参数(url)` : "";

  // ---------- 上下文(每次会话注入系统上下文; 剧本创作时按需拼接详细规范) ----------
  const system = needScriptSkill(message) ? `${SYSTEM_PROMPT}\n\n${SCRIPT_SKILL}` : SYSTEM_PROMPT;
  const history: ChatMsg[] = [
    { role: "system", content: system },
    ...(b.messages || [])
      .slice(-20)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() && !m.content.startsWith("(调用失败)") && !m.content.startsWith("(加载失败)"))
      .map((m) => ({
        role: m.role,
        content: m.content,
        images: (m.images || []).map(localImageToDataUrl).filter((x): x is string => !!x),
      })),
  ];
  history.push({ role: "user", content: `${message}${attachText}${mediaHint}`, images, videos });

  const apiKey = await getApiKey();
  if (!apiKey) return Response.json({ detail: "未配置 API Key(请点右上角 API Key 按钮设置)" }, { status: 400 });
  // 模型优先级: 前端传入 > 环境变量 > 默认(前端切换模型时传)
  const modelId = String(b.model || "").trim() || process.env.DOUBAO_CHAT_MODEL || "doubao-seed-2-0-mini-260428";

  try {
    let scriptsChanged = false;
    const videoTaskIds: string[] = []; // AI 本轮发起的视频任务(前端轮询完成状态)
    // 上一条助手回复(保存"刚输出的剧本"时用, 免去模型重写全文)
    const lastAssistant = [...(b.messages || [])].reverse()
      .find((m) => m && m.role === "assistant" && typeof m.content === "string" && m.content.trim())?.content || "";
    // 按意图装载工具(日常对话不带工具, 最快)
    const msgForIntent = message + (attachText ? "\n[附件]" : "");
    const tools = pickToolsByIntent(msgForIntent, attachFiles.length > 0);
    const reply = await chat(apiKey, modelId, history, {
      tools: tools.length ? tools : undefined,
      onToolCall: async (name, args) => {
        // 数据查询/修改/删除(修改删除已含 confirm 确认校验)
        const dataTool = execDataTool(name, args);
        if (dataTool) {
          if (DATA_TOOL_WRITES.has(name)) scriptsChanged = true; // 改/删之后前端刷新库
          return await dataTool();
        }
        // 播放/展示: 新工具
        if (name === "transform_script") {
          const r = await execAddScript(args); // 复用入库+解析
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        if (name === "video_to_script") {
          // B 方案: 只出初稿不落库(scriptsChanged 由后续 add_script 触发)
          return await execVideoToScript(apiKey, modelId, args);
        }
        if (name === "create_video") {
          const r = await execCreateVideo(args);
          try {
            const parsed = JSON.parse(r) as { task_id?: string };
            if (parsed.task_id) videoTaskIds.push(parsed.task_id);
          } catch { /* ignore */ }
          return r;
        }
        const lib = LIB_META[name];
        if (lib) {
          // 本轮附件图自动转图库并关联
          const imgIds = await registerChatImages(chatImageUrls);
          const r = await execLibAdd(lib.table as LibraryTable, args, imgIds);
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        if (name === "save_last_script") {
          const r = await execSaveLastScript(args, lastAssistant);
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        if (name === "add_script") {
          // 工具未传 file_path 且内容来自附件时, 用附件文件路径驼底
          if (!String(args.file_path ?? "").trim() && attachFiles.length) {
            args.file_path = attachFiles[0].path;
          }
          const r = await execAddScript(args);
          const parsed = JSON.parse(r) as { ok?: boolean };
          if (parsed.ok) scriptsChanged = true;
          return r;
        }
        if (name === "read_file") {
          return await execReadFile(args);
        }
        return JSON.stringify({ ok: false, detail: `未知工具 ${name}` });
      },
    });
    return Response.json({ reply, scriptsChanged, videoTaskIds });
  } catch (e) {
    if (e instanceof DoubaoError) return Response.json({ detail: `对话失败: ${e.code}` }, { status: 502 });
    return Response.json({ detail: (e as Error).message }, { status: 500 });
  }
}