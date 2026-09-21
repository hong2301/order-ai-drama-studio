// 视频生成 facade —— API 层只跟这个文件打交道
// 统一入口: 创建任务(写 DB) / 刷新任务(拉商家+视频落盘本地)+落库 / 模型列表
import fs from "fs";
import path from "path";
import { dataDir, getDb, persist, queryAll, queryOne } from "@/lib/server/db";
import type { VideoTask, VideoTaskStatus } from "./types";
import { getModelDef, getProvider, listModelDefs } from "./registry";

export const TABLE = "video_tasks";

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
    videoUrl: r.video_url ? String(r.video_url) : null,
    error: r.error ? String(r.error) : null,
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

  const t = await provider.submit({
    model: def.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl || null,
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
    `INSERT INTO ${TABLE}(id,provider,model_key,model,script_name,prompt,image_url,status,error,resolution,ratio,duration,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "doubao", input.modelKey, input.modelKey, input.scriptName || "", input.prompt, "", "queued", "",
     input.resolution || "", input.ratio || "", input.duration ? String(input.duration) : "", now, now],
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
    if (local.id.startsWith("local-") || age < 60 * 1000) {
      return { ...local, error: null };
    }
    // 方舟查询失败/超时: 任务已挂较久(>20分钟仍非终态) → 安全标记失败, 避免占位永久悬挂
    if (age > 20 * 60 * 1000) {
      const msg = `查询方舟失败, 任务可能已失效: ${(e as Error).message}`.slice(0, 160);
      const now = new Date().toISOString();
      db.run(`UPDATE ${TABLE} SET status=?, error=?, updated_at=? WHERE id=?`, ["failed", msg, now, id]);
      await persist();
      return { ...local, status: "failed" as VideoTaskStatus, error: msg, updatedAt: now };
    }
    return { ...local, error: (e as Error).message };
  }
  // 成功且 video_url 是商家外链 → 下载到本地(方舟 URL 有时效, 视频库须持久保存)
  if (fresh.status === "succeeded" && fresh.videoUrl && /^https?:\/\//.test(fresh.videoUrl)) {
    const localUrl = await downloadVideo(id, fresh.videoUrl);
    if (localUrl) fresh.videoUrl = localUrl;
  }
  const now = new Date().toISOString();
  db.run(
    `UPDATE ${TABLE} SET status=?, video_url=?, error=?, updated_at=? WHERE id=?`,
    [fresh.status, fresh.videoUrl || "", fresh.error || "", now, id],
  );
  await persist();
  return {
    ...local,
    status: fresh.status,
    videoUrl: fresh.videoUrl || local.videoUrl,
    error: fresh.error || local.error,
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