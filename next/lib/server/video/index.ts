// 视频生成 facade —— API 层只跟这个文件打交道
// 统一入口: 创建任务(写 DB) / 刷新任务(拉商家)+落库 / 模型列表
import { dataDir, getDb, persist, queryAll, queryOne } from "@/lib/server/db";
import type { VideoTask, VideoTaskStatus } from "./types";
import { getModelDef, getProvider, listModelDefs } from "./registry";

const TABLE = "video_tasks";

function rowToTask(r: Record<string, unknown>): VideoTask {
  return {
    id: String(r.id),
    provider: String(r.provider || ""),
    modelKey: String(r.model_key || ""),
    model: String(r.model || ""),
    prompt: String(r.prompt || ""),
    imageUrl: r.image_url ? String(r.image_url) : null,
    status: String(r.status) as VideoTaskStatus,
    videoUrl: r.video_url ? String(r.video_url) : null,
    error: r.error ? String(r.error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** 建表(sql.js 无 migrations, 幂等 CREATE IF NOT EXISTS) */
export async function ensureVideoTables(): Promise<void> {
  const db = await getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id         TEXT PRIMARY KEY,
      provider   TEXT DEFAULT 'doubao',
      model_key  TEXT DEFAULT '',
      model      TEXT DEFAULT '',
      prompt     TEXT DEFAULT '',
      image_url  TEXT DEFAULT '',
      status     TEXT DEFAULT 'queued',
      video_url  TEXT DEFAULT '',
      error      TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
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

  const t = await provider.submit({
    model: def.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl || null,
    resolution: input.resolution,
    ratio: input.ratio,
    duration: input.duration,
  });
  await ensureVideoTables();
  const now = new Date().toISOString();
  const task: VideoTask = {
    id: t.id,
    provider: def.provider,
    modelKey: def.key,
    model: def.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl || null,
    status: t.status,
    videoUrl: t.videoUrl || null,
    error: t.error || null,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  db.run(
    `INSERT INTO ${TABLE}(id,provider,model_key,model,prompt,image_url,status,video_url,error,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [task.id, task.provider, task.modelKey, task.model, task.prompt,
     task.imageUrl || "", task.status, task.videoUrl || "", task.error || "", now, now],
  );
  await persist();
  return task;
}

/** 拉商家最新状态并落库, 返回更新后的任务(不存在于本地则返回 null) */
export async function refreshVideoTask(id: string): Promise<VideoTask | null> {
  const db = await getDb();
  const row = queryOne(db, `SELECT * FROM ${TABLE} WHERE id=?`, [id]);
  if (!row) return null;
  const local = rowToTask(row);
  // 已终态(成功/失败/取消)不需要再问商家
  if (local.status === "succeeded" || local.status === "failed" || local.status === "cancelled") return local;

  const provider = getProvider(local.provider);
  if (!provider) return local;
  let fresh;
  try {
    fresh = await provider.get(id);
  } catch (e) {
    return { ...local, error: (e as Error).message };
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

/** 任务列表(最新的在前) */
export async function listVideoTasks(limit = 50): Promise<VideoTask[]> {
  const db = await getDb();
  const rows = queryAll(db, `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`, [limit]);
  return rows.map(rowToTask);
}

export { listModelDefs };