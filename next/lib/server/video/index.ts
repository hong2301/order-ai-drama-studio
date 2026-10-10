// 视频生成 facade —— API 层只跟这个文件打交道
// 统一入口: 创建任务(写 DB) / 刷新任务(拉商家+视频落盘本地)+落库 / 模型列表
import fs from "fs";
import path from "path";
import { dataDir, getDb, persist, queryAll, queryOne } from "@/lib/server/db";
import type { VideoTask, VideoTaskStatus } from "./types";
import { getModelDef, getProvider, listModelDefs } from "./registry";

export const TABLE = "video_tasks";

/** 将方舟/接口原始错误翻译为中文友好提示(命中规则加说明, 否则原样) */
const ERROR_RULES: [RegExp, string][] = [
  // 必须放在 SensitiveContentDetected 之前: 后者会把这个更具体的码一并吃掉
  [/InputImageSensitiveContentDetected|may contain real person/i, "参考图含真人面孔, 平台不接受(Seedance 2.0/2.5 限制); 请改用非写实人物图/预置虚拟人像/已授权素材"],
  [/SensitiveContentDetected/i, "平台内容审核拦截"],
  [/Copyright|版权/i, "可能涉及版权内容"],
  [/ModelNotOpen/i, "该模型未开通，请在火山方舟控制台开通后再试"],
  [/InvalidAuthentication|AuthenticationError|API key format/i, "API Key 无效或未配置，请点右上角按钮设置正确 Key"],
  [/RateLimit|TooManyRequests/i, "调用频率过高，请稍后再试"],
  [/InvalidParameter.*duration/i, "时长参数超出该模型支持范围"],
  [/InvalidParameter.*resolution/i, "分辨率参数不被该模型支持"],
  [/InvalidParameter.*ratio/i, "画面比例不被该模型支持"],
  [/InvalidParameter.*not valid/i, "参数不被该模型支持"],
  [/ModelNotExist|NotFound/i, "模型/任务不存在或已下线"],
  [/width to be at least (\d+)px/i, "图片尺寸过小(宽需≥300px), 请更换更大的图片"],
];
export function friendlyVideoError(raw: string): string {
  const s = String(raw || "");
  // 幂等: 已含中文(已翻译过)的不重复翻译
  if (/[\u4e00-\u9fff]/.test(s.slice(0, 40))) return s.slice(0, 200);
  for (const [re, zh] of ERROR_RULES) {
    if (re.test(s)) {
      const code = s.split(":")[0].split("$")[0].trim().slice(0, 60);
      return `${zh}${code ? `（${code}）` : ""}`.slice(0, 120);
    }
  }
  return s.slice(0, 160);
}

/** 轻量解析本地图片宽高(PNG/JPEG 文件头), 失败返回 null */
export function readImageSize(file: string): { w: number; h: number } | null {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 24) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50) { // PNG: IHDR 宽高在字节 16/20
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: 扫 SOF 段
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") {
      const chunk = buf.slice(12, 40).toString("latin1");
      if (chunk.startsWith("VP8 ")) { // lossy: 帧头(3)+start code(3) 后 14bit 宽高
        const w = buf[26] | ((buf[27] & 0x3f) << 8);
        const h = buf[28] | ((buf[29] & 0x3f) << 8);
        return { w, h };
      }
      if (chunk.startsWith("VP8L")) { // lossless: 1byte 后 14bit 宽高
        const b1 = buf[21], b2 = buf[22], b3 = buf[23], b4 = buf[24];
        return { w: (b1 | ((b2 & 0x3f) << 8)) + 1, h: (((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) >> 0) + 1 };
      }
      if (chunk.startsWith("VP8X")) { // extended: 24bit 宽高(各 -1)
        let w = 0, h = 0;
        for (let k = 0; k < 3; k++) { w |= buf[24 + k] << (8 * k); h |= buf[27 + k] << (8 * k); }
        return { w: w + 1, h: h + 1 };
      }
    }
  } catch { /* ignore */ }
  return null;
}

function rowToTask(r: Record<string, unknown>): VideoTask {
  return {
    id: String(r.id),
    provider: String(r.provider || ""),
    modelKey: String(r.model_key || ""),
    model: String(r.model || ""),
    scriptName: r.script_name ? String(r.script_name) : "",
    prompt: String(r.prompt || ""),
    imageUrl: r.image_url ? String(r.image_url) : null,
    status: String(r.status) as VideoTaskStatus,
    stage: r.stage ? String(r.stage) : undefined,
    videoUrl: r.video_url ? String(r.video_url) : null,
    error: r.error ? friendlyVideoError(String(r.error)) : null,
    resolution: r.resolution ? String(r.resolution) : "",
    ratio: r.ratio ? String(r.ratio) : "",
    duration: r.duration ? String(r.duration) : "",
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** 建表 + 迁移(sql.js 无 migrations, 幂等 CREATE/ALTER) */
export async function ensureVideoTables(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id         TEXT PRIMARY KEY,
      provider   TEXT DEFAULT 'doubao',
      model_key  TEXT DEFAULT '',
      model      TEXT DEFAULT '',
      script_name TEXT DEFAULT '',
      prompt     TEXT DEFAULT '',
      image_url  TEXT DEFAULT '',
      status     TEXT DEFAULT 'queued',
      video_url  TEXT DEFAULT '',
      error      TEXT DEFAULT '',
      resolution TEXT DEFAULT '',
      ratio      TEXT DEFAULT '',
      duration   TEXT DEFAULT '',
      stage      TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  try {
    const cols = db.exec(`PRAGMA table_info(${TABLE})`)[0]?.values.map((r) => r[1]);
    if (cols && !cols.includes("script_name")) db.run(`ALTER TABLE ${TABLE} ADD COLUMN script_name TEXT DEFAULT ''`);
    if (cols && !cols.includes("resolution")) db.run(`ALTER TABLE ${TABLE} ADD COLUMN resolution TEXT DEFAULT ''`);
    if (cols && !cols.includes("ratio")) db.run(`ALTER TABLE ${TABLE} ADD COLUMN ratio TEXT DEFAULT ''`);
    if (cols && !cols.includes("duration")) db.run(`ALTER TABLE ${TABLE} ADD COLUMN duration TEXT DEFAULT ''`);
    if (cols && !cols.includes("stage")) db.run(`ALTER TABLE ${TABLE} ADD COLUMN stage TEXT DEFAULT ''`);
  } catch { /* 已存在 */ }
  await persist();
}

/**
 * 创建视频生成任务: 校验模型 → 商家 submit → 落库。
 * 商家已完成的(succeeded/failed)也照常落库返回。
 */
export async function createVideoTask(input: {
  modelKey: string;
  prompt: string;
  imageUrl?: string | null;
  /** 参考图(文生锚定人物/场景/产品形象) */
  referenceImages?: { name?: string; url: string }[];
  /** 参考音频(音色参考) —— **长剧本用, 短剧本不传**; 需与参考图/首帧搭配, 不能单独传 */
  referenceAudios?: { name?: string; url: string }[];
  resolution?: string;
  ratio?: string;
  duration?: number;
  /** 关联剧本名(视频库展示用) */
  scriptName?: string;
}): Promise<VideoTask> {
  const def = getModelDef(input.modelKey);
  if (!def) throw new Error(`未知模型: ${input.modelKey}`);
  if (def.status !== "active" && def.status !== "retiring") {
    throw new Error(`模型「${def.name}」当前不可用: ${def.note || "请先在注册表启用"}`);
  }
  const provider = getProvider(def.provider);
  if (!provider) throw new Error(`未注册的商家 provider: ${def.provider}`);
  if (!input.prompt?.trim() && !input.imageUrl) throw new Error("至少需要提示词或图片");

  // 能力校验: 模型不支持的控制参数直接报错(前端也会按 presets 禁用)
  const p = def.presets;
  if (input.resolution && p?.resolutions && !p.resolutions.includes(input.resolution)) {
    throw new Error(`模型「${def.name}」不支持分辨率 ${input.resolution}(可选: ${p.resolutions.join("/")})`);
  }
  if (input.ratio && p?.ratios && !p.ratios.includes(input.ratio)) {
    throw new Error(`模型「${def.name}」不支持比例 ${input.ratio}`);
  }
  if (input.duration && (p ? !p.duration : true)) {
    throw new Error(`模型「${def.name}」不支持自定义时长`);
  }
  // 时长上限不写死在代码里: 原样交给模型接口, 超出时 provider 取接口返回的上限重试并回传提示
  const duration = input.duration;

  // 参考图(人物/场景/产品锚定)校验 —— 官方「图生视频-参考图」仅 Seedance 2.0 系列及以上支持,
  // 且与首帧图互斥(图生视频 / 全模态参考是不可混用的两种场景)
  let referenceImages = input.referenceImages || [];
  if (referenceImages.length) {
    if (input.imageUrl) throw new Error("参考图与首帧图不能同时使用(方舟: 图生视频与全模态参考为互斥场景)");
    const maxRef = p?.maxReferenceImages || 0;
    if (!maxRef) throw new Error(`模型「${def.name}」不支持参考图锚定(人物/场景/产品), 请改用 Seedance 2.0 系列模型`);
    if (referenceImages.length > maxRef) {
      console.log(`[video] 参考图 ${referenceImages.length} 张超出「${def.name}」上限 ${maxRef} 张, 已截断`);
      referenceImages = referenceImages.slice(0, maxRef);
    }
  }

  const t = await provider.submit({
    model: def.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl || null,
    referenceImages,
    referenceAudios: input.referenceAudios,
    resolution: input.resolution,
    ratio: input.ratio,
    duration,
  });
  await ensureVideoTables();
  const now = new Date().toISOString();
  const task: VideoTask = {
    id: t.id,
    provider: def.provider,
    modelKey: def.key,
    model: def.model,
    scriptName: input.scriptName || "",
    prompt: input.prompt,
    resolution: input.resolution || "",
    ratio: input.ratio || "",
    duration: t.durationUsed ? String(t.durationUsed) : duration ? String(duration) : "",
    durationAdjustedFrom: t.durationAdjustedFrom,
    imageUrl: input.imageUrl || null,
    status: t.status,
    videoUrl: t.videoUrl || null,
    error: t.error || null,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  db.run(
    `INSERT INTO ${TABLE}(id,provider,model_key,model,script_name,prompt,image_url,status,video_url,error,resolution,ratio,duration,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [task.id, task.provider, task.modelKey, task.model, task.scriptName, task.prompt,
     task.imageUrl || "", task.status, task.videoUrl || "", task.error || "",
     task.resolution || "", task.ratio || "", task.duration || "", now, now],
  );
  await persist();
  return task;
}

/** 立即创建占位任务(生成中占位): 后台适配+提交完成后会用真实方舟任务替换(id 更新) */
export async function createPlaceholderTask(input: {
  modelKey: string; prompt: string; resolution?: string; ratio?: string; duration?: number; scriptName?: string;
}): Promise<VideoTask> {
  await ensureVideoTables();
  const db = await getDb();
  const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO ${TABLE}(id,provider,model_key,model,script_name,prompt,image_url,status,error,resolution,ratio,duration,stage,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "doubao", input.modelKey, input.modelKey, input.scriptName || "", input.prompt, "", "queued", "",
     input.resolution || "", input.ratio || "", input.duration ? String(input.duration) : "", "adapting", now, now],
  );
  await persist();
  const row = queryOne(db, `SELECT * FROM ${TABLE} WHERE id=?`, [id]);
  return (row ? rowToTask(row) : {
    id, provider: "doubao", modelKey: input.modelKey, model: input.modelKey, scriptName: input.scriptName || "",
    prompt: input.prompt, resolution: input.resolution || "", ratio: input.ratio || "",
    duration: input.duration ? String(input.duration) : "", imageUrl: null,
    status: "queued" as const, videoUrl: null, error: null, createdAt: now, updatedAt: now,
  });
}

/** 下载商家视频到本地 data/uploads/videos/<id>.mp4, 返回本地 URL(失败留外链) */
async function downloadVideo(id: string, url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const dir = path.join(dataDir(), "uploads", "videos");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.mp4`), buf);
    return `/api/uploads/videos/${id}.mp4`;
  } catch { return null; }
}

/** 拉商家最新状态并落库, 返回更新后的任务(不存在于本地则返回 null) */
export async function refreshVideoTask(id: string): Promise<VideoTask | null> {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM ${TABLE} WHERE id=?`, [id]);
  if (!row) return null;
  const local = rowToTask(row);
  // 已终态(成功/失败/取消)不需要再问商家; 但成功的若还是商家外链(旧任务)则补下载本地化
  if (local.status === "succeeded" || local.status === "failed" || local.status === "cancelled") {
    if (local.status === "succeeded" && local.videoUrl && /^https?:\/\//.test(local.videoUrl)) {
      const localUrl = await downloadVideo(id, local.videoUrl);
      if (localUrl) {
        const now = new Date().toISOString();
        db.run(`UPDATE ${TABLE} SET video_url=?, updated_at=? WHERE id=?`, [localUrl, now, id]);
        await persist();
        return { ...local, videoUrl: localUrl, updatedAt: now };
      }
    }
    return local;
  }

  const provider = getProvider(local.provider);
  if (!provider) return local;
  let fresh;
  try {
    fresh = await provider.get(id);
  } catch (e) {
    // 占位任务(local- 前缀: 后台还在适配/提交, 真实方舟 id 未就位)——或刚创建的任务: 原样返回(前端继续"生成中"), 不标错
    const born = Date.parse(local.updatedAt || local.createdAt || "") || Date.now();
    const age = Date.now() - born;
    if (local.id.startsWith("local-")) {
      // 占位: 300s 内视为正常(适配/提交中, 提交可能要排队); 超过 → 标记失败, 避免占位永久悬挂
      // 注意: 保留已有 error —— 若后台已写入真实失败原因(如方舟审核拦截), 不要被兜底文案盖掉
      if (age < 300_000) return { ...local, error: local.error || null };
      const msg = local.error || "生成提交超时(后台可能中断), 请重试";
      const now = new Date().toISOString();
      db.run(`UPDATE ${TABLE} SET status=?, error=?, updated_at=? WHERE id=?`, ["failed", msg, now, id]);
      await persist();
      return { ...local, status: "failed" as VideoTaskStatus, error: msg, updatedAt: now };
    }
    if (age < 60 * 1000) {
      return { ...local, error: null };
    }
    // 方舟查询失败/超时: 任务已挂较久(>20分钟仍非终态) → 安全标记失败, 避免占位永久悬挂
    if (age > 20 * 60 * 1000) {
      const msg = `查询方舟失败, 任务可能已失效: ${(e as Error).message}`.slice(0, 160);
      const now = new Date().toISOString();
      db.run(`UPDATE ${TABLE} SET status=?, error=?, updated_at=? WHERE id=?`, ["failed", msg, now, id]);
      await persist();
      return { ...local, status: "failed" as VideoTaskStatus, error: friendlyVideoError(msg), updatedAt: now };
    }
    return { ...local, error: friendlyVideoError((e as Error).message) };
  }
  // 成功且 video_url 是商家外链 → 下载到本地(方舟 URL 有时效, 视频库须持久保存)
  if (fresh.status === "succeeded" && fresh.videoUrl && /^https?:\/\//.test(fresh.videoUrl)) {
    const localUrl = await downloadVideo(id, fresh.videoUrl);
    if (localUrl) fresh.videoUrl = localUrl;
  }
  const now = new Date().toISOString();
  db.run(
    `UPDATE ${TABLE} SET status=?, video_url=?, error=?, updated_at=? WHERE id=?`,
    [fresh.status, fresh.videoUrl || "", friendlyVideoError(fresh.error || ""), now, id],
  );
  await persist();
  return {
    ...local,
    status: fresh.status,
    videoUrl: fresh.videoUrl || local.videoUrl,
    error: friendlyVideoError(fresh.error || "") || local.error,
    updatedAt: now,
  };
}

/** 任务列表(completed 按完成时间最新在前, 生成中的跟在后面; 分页) */
export async function listVideoTasks(limit = 50, offset = 0): Promise<VideoTask[]> {
  const db = await getDb();
  const rows = queryAll(
    db,
    `SELECT * FROM ${TABLE}
     ORDER BY CASE status WHEN 'succeeded' THEN 0 else 1 END, updated_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return rows.map(rowToTask);
}

/** 生成中任务数(queued/running, 含占位) —— 视频库徽标用 */
export async function pendingVideoTaskCount(): Promise<number> {
  const db = await getDb();
  const r = queryOne(db, `SELECT COUNT(*) AS n FROM ${TABLE} WHERE status IN ('queued','running')`);
  return Number(r?.n ?? 0);
}

/** 删除任务记录 + 本地视频文件 */
export async function deleteVideoTask(id: string): Promise<boolean> {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM ${TABLE} WHERE id=?`, [id]);
  if (!row) return false;
  db.run(`DELETE FROM ${TABLE} WHERE id=?`, [id]);
  await persist();
  // 清理本地文件
  try {
    const f = path.join(dataDir(), "uploads", "videos", `${id}.mp4`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch { /* ignore */ }
  return true;
}

export { listModelDefs };