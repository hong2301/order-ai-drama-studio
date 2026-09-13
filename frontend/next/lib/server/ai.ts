// AI 模型配置数据访问层(移植自 backend/app/repositories/ai_repo.py)
import { getDb, persist, queryAll, queryOne } from "./db";
import type { Row } from "./catalog";
import type { AiConfig } from "../../app/lib/types";

function parseCapability(r: Row): AiConfig {
  try { r.capability = JSON.parse((r.capability as string) || "{}"); } catch { r.capability = {}; }
  return r as unknown as AiConfig;
}

export async function listConfigs(enabledOnly = false): Promise<AiConfig[]> {
  const db = await getDb();
  const sql = `SELECT * FROM ai_config${enabledOnly ? " WHERE enabled=1" : ""} ORDER BY sort_order, id`;
  return queryAll<Row>(db, sql).map(parseCapability);
}

export async function getConfig(id: number): Promise<AiConfig | undefined> {
  const db = await getDb();
  const r = queryOne<Row>(db, "SELECT * FROM ai_config WHERE id=?", [id]);
  return r ? parseCapability(r) : undefined;
}

export async function getByModelId(modelId: string): Promise<AiConfig | undefined> {
  const db = await getDb();
  const r = queryOne<Row>(db, "SELECT * FROM ai_config WHERE model_id=? AND enabled=1", [modelId]);
  return r ? parseCapability(r) : undefined;
}

export async function createConfig(p: Row): Promise<AiConfig> {
  const db = await getDb();
  db.prepare("INSERT INTO ai_config(name,provider,api_key,model_id,kind,capability,cost_note,desc,enabled,sort_order) " +
    "VALUES(?,?,?,?,?,?,?,?,?,?)").run([
      (p.name as string) || "", (p.provider as string) || "doubao", (p.api_key as string) || "",
      (p.model_id as string) || "", (p.kind as string) || "video",
      JSON.stringify(p.capability || {}),
      (p.cost_note as string) || "", (p.desc as string) || "",
      p.enabled === false ? 0 : 1,
      typeof p.sort_order === "number" ? p.sort_order : 999,
    ]);
  const id = queryOne<{ id: number }>(db, "SELECT last_insert_rowid() id")!.id;
  persist();
  return (await getConfig(id))!;
}

export async function updateConfig(id: number, p: Row): Promise<AiConfig | undefined> {
  const db = await getDb();
  if (!queryOne<Row>(db, "SELECT id FROM ai_config WHERE id=?", [id])) return undefined;
  db.prepare("UPDATE ai_config SET name=?,provider=?,api_key=?,model_id=?,kind=?,capability=?,cost_note=?,desc=?,enabled=?,sort_order=? WHERE id=?").run([
      (p.name as string) || "", (p.provider as string) || "doubao", (p.api_key as string) || "",
      (p.model_id as string) || "", (p.kind as string) || "video",
      JSON.stringify(p.capability || {}),
      (p.cost_note as string) || "", (p.desc as string) || "",
      p.enabled === false ? 0 : 1,
      typeof p.sort_order === "number" ? p.sort_order : 999,
      id,
    ]);
  persist();
  return getConfig(id);
}

export async function deleteConfig(id: number): Promise<boolean> {
  const db = await getDb();
  const changed = db.prepare("DELETE FROM ai_config WHERE id=?").run([id]).changes;
  persist();
  return changed > 0;
}