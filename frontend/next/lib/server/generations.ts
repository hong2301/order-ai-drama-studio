// 生成记录数据访问层(移植自 backend/app/repositories/generations_repo.py)
import { getDb, persist, queryAll, queryOne } from "./db";
import type { Row } from "./catalog";
import type { Generation } from "../../app/lib/types";

function parseExtra(r: Row): Generation {
  try { r.extra = JSON.parse((r.extra as string) || "{}"); } catch { r.extra = {}; }
  return r as unknown as Generation;
}

export async function listGenerations(limit = 50): Promise<Generation[]> {
  const db = await getDb();
  return queryAll<Row>(db, "SELECT * FROM generations ORDER BY id DESC LIMIT ?", [limit]).map(parseExtra);
}

export async function getGeneration(gid: number): Promise<Generation | undefined> {
  const db = await getDb();
  const r = queryOne<Row>(db, "SELECT * FROM generations WHERE id=?", [gid]);
  return r ? parseExtra(r) : undefined;
}

export async function createGeneration(p: Row): Promise<number> {
  const db = await getDb();
  db.prepare("INSERT INTO generations(mode,title,prompt,model_id,status,duration,resolution,ratio,seed,extra) " +
    "VALUES(?,?,?,?,?,?,?,?,?,?)").run([
      (p.mode as string) || "structured", (p.title as string) || "", (p.prompt as string) || "",
      (p.model_id as string) || "", (p.status as string) || "draft",
      typeof p.duration === "number" ? p.duration : 5,
      (p.resolution as string) || "720p", (p.ratio as string) || "9:16",
      typeof p.seed === "number" ? p.seed : -1,
      JSON.stringify(p.extra || {}),
    ]);
  const id = queryOne<{ id: number }>(db, "SELECT last_insert_rowid() id")!.id;
  persist();
  return id;
}

/** 更新状态与可选字段(task_id/video_url/local_path/seed/error) */
export async function updateStatus(
  gid: number, status: string, fields: Partial<Record<"task_id" | "video_url" | "local_path" | "seed" | "error", unknown>> = {}
): Promise<void> {
  const db = await getDb();
  const sets = ["status=?", "updated_at=datetime('now','localtime')"];
  const values: unknown[] = [status];
  for (const k of ["task_id", "video_url", "local_path", "seed", "error"] as const) {
    if (k in fields) {
      sets.push(`${k}=?`);
      values.push(fields[k] ?? "");
    }
  }
  db.prepare(`UPDATE generations SET ${sets.join(", ")} WHERE id=?`).run([...values, gid]);
  persist();
}

export async function deleteGeneration(gid: number): Promise<boolean> {
  const db = await getDb();
  const changed = db.prepare("DELETE FROM generations WHERE id=?").run([gid]).changes;
  persist();
  return changed > 0;
}