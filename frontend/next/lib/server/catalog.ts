// 字典档数据访问层(移植自 backend/app/repositories/catalog_repo.py + routers/catalog.py 通用工厂)
// 统一约定: JSON 列(fit_persons/appear_ways/beats/segments)读取时解析为对象
import { getDb, persist, queryAll, queryOne } from "./db";

export type Row = Record<string, unknown>;

export interface ResourceRepo {
  list(activeOnly?: boolean): Promise<Row[]>;
  get(id: number): Promise<Row | undefined>;
  create(payload: Row): Promise<number>;
  update(id: number, payload: Row): Promise<boolean>;
  remove(id: number): Promise<boolean>;
}

interface CrudSpec {
  table: string;
  cols: string[];            // 可写列(不含 id/sort_order/active)
  jsonCols?: string[];       // 读取时 JSON.parse
  intCols?: string[];        // 强制转 number
  defaults?: Record<string, unknown>;
}

function norm(v: unknown): unknown {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);   // array/object -> JSON 字符串
}

function parseJson(row: Row, jsonCols: string[]): Row {
  for (const c of jsonCols) {
    try { row[c] = JSON.parse((row[c] as string) || "[]"); } catch { row[c] = []; }
  }
  return row;
}

/** 通用 CRUD 工厂(对应 Python 的 make_crud_router) */
export function makeCrud(spec: CrudSpec): ResourceRepo {
  const { table, cols, jsonCols = [], intCols = [], defaults = {} } = spec;

  const mapRow = (r: Row | undefined): Row | undefined => (r ? parseJson(r, jsonCols) : undefined);

  return {
    async list(activeOnly = false): Promise<Row[]> {
      const db = await getDb();
      const sql = `SELECT * FROM ${table}${activeOnly ? " WHERE active=1" : ""} ORDER BY sort_order, id`;
      return queryAll<Row>(db, sql).map((r) => parseJson(r, jsonCols));
    },
    async get(id: number): Promise<Row | undefined> {
      const db = await getDb();
      return mapRow(queryOne<Row>(db, `SELECT * FROM ${table} WHERE id=?`, [id]));
    },
    async create(payload: Row): Promise<number> {
      const db = await getDb();
      const names = [...cols, "active", "sort_order"];
      const values = [
        ...cols.map((c) => norm(payload[c] ?? defaults[c] ?? "")),
        payload.active === undefined ? 1 : payload.active ? 1 : 0,
        typeof payload.sort_order === "number" ? payload.sort_order : 999,
      ];
      db.prepare(
        `INSERT INTO ${table}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`
      ).run(values);
      const id = queryOne<{ id: number }>(db, "SELECT last_insert_rowid() id")!.id;
      persist();
      return id;
    },
    async update(id: number, payload: Row): Promise<boolean> {
      const db = await getDb();
      if (!queryOne<Row>(db, `SELECT id FROM ${table} WHERE id=?`, [id])) return false;
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const c of cols) {
        sets.push(`${c}=?`);
        let v: unknown = payload[c] ?? defaults[c] ?? "";
        if (intCols.includes(c)) v = Number(v) || 0;
        values.push(norm(v));
      }
      sets.push("active=?");
      values.push(payload.active === undefined ? 1 : payload.active ? 1 : 0);
      db.prepare(`UPDATE ${table} SET ${sets.join(",")} WHERE id=?`).run([...values, id]);
      persist();
      return true;
    },
    async remove(id: number): Promise<boolean> {
      const db = await getDb();
      const changed = db.prepare(`DELETE FROM ${table} WHERE id=?`).run([id]).changes;
      persist();
      return changed > 0;
    },
  };
}

// ---------- 五个字典档 ----------
export const charactersRepo = makeCrud({
  table: "characters",
  cols: ["name", "family_role", "age", "profession", "traits", "look", "prompt", "photos"],
  jsonCols: ["photos"],
  intCols: ["age"],
  defaults: { name: "", family_role: "", age: 0, profession: "", traits: "", look: "", prompt: "", photos: [] },
});

export const productsRepo = makeCrud({
  table: "products",
  cols: ["name", "category", "fit_persons", "appear_ways", "desc", "prompt"],
  jsonCols: ["fit_persons", "appear_ways"],
  defaults: { name: "", category: "", fit_persons: [], appear_ways: [], desc: "", prompt: "" },
});

export const scenesRepo = makeCrud({
  table: "scenes",
  cols: ["name", "location", "desc", "atmosphere", "timing", "prompt"],
  defaults: { name: "", location: "", desc: "", atmosphere: "", timing: "", prompt: "" },
});

export const templatesRepo = makeCrud({
  table: "story_templates",
  cols: ["name", "story_line", "relation_hint", "conflict", "beats", "example", "seed_prompt"],
  jsonCols: ["beats"],
  defaults: { name: "", story_line: "", relation_hint: "", conflict: "", beats: [], example: "", seed_prompt: "" },
});

export const rhythmsRepo = makeCrud({
  table: "video_rhythms",
  cols: ["name", "duration", "desc", "segments"],
  jsonCols: ["segments"],
  intCols: ["duration"],
  defaults: { name: "", duration: 15, desc: "", segments: [] },
});

// 资源注册表: 供通用路由使用
export const RESOURCES: Record<string, { repo: ResourceRepo; label: string }> = {
  characters: { repo: charactersRepo, label: "人物" },
  products: { repo: productsRepo, label: "产品" },
  scenes: { repo: scenesRepo, label: "场景" },
  "story-templates": { repo: templatesRepo, label: "文本模板" },
  "video-rhythms": { repo: rhythmsRepo, label: "视频节奏" },
};