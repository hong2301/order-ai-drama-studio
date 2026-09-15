// SQLite 数据层(sql.js 纯 WASM 实现, dev/Electron 同构, 零原生编译/零 ABI 问题)
// 数据路径: dev = 项目根 data/(next.config 注入 DRAMA_DATA_DIR); 正式版 = exe 同级 data/(Electron 注入)
import fs from "fs";
import path from "path";
import type { Database, SqlJsStatic } from "sql.js";

// 静态 require("sql.js"): serverExternalPackages 外部化为 Node 原生 require (webpack 不截获)
// wasm 路径: 纯 fs 从 __dirname 向上找(不经过 require.resolve —— external 下解析不可靠)
declare const require: ((id: string) => unknown) & { resolve: (id: string) => string };

function findWasmPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const p = path.join(dir, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
}

let _sql: SqlJsStatic | null = null;
async function getSql(): Promise<SqlJsStatic> {
  if (!_sql) {
    const mod = require("sql.js") as unknown;
    const initFn = (mod as { default?: unknown }).default ?? mod;
    _sql = (await (initFn as (cfg?: { locateFile?: (f: string) => string }) => Promise<SqlJsStatic>)({
      locateFile: () => findWasmPath(),
    }));
  }
  return _sql;
}

let _dataDir: string | null = null;
export function dataDir(): string {
  if (_dataDir) return _dataDir;
  _dataDir = process.env.DRAMA_DATA_DIR || path.join(process.cwd(), "..", "data");
  return _dataDir;
}

let _ready: Promise<Database> | null = null;

// ---------- 查询帮助 ----------
export function queryAll(db: Database, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}
export function queryOne(db: Database, sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  return queryAll(db, sql, params)[0];
}

/** 每次写操作后同步落盘(数据量小, 全量导出成本可忽略) */
export async function persist(): Promise<void> {
  try {
    const db = await _ready;
    if (db) {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(path.join(dataDir(), "drama.db"), Buffer.from(db.export()));
    }
  } catch { /* ignore */ }
}

export function getDb(): Promise<Database> {
  if (!_ready) {
    _ready = (async () => {
      const sql = await getSql();
      fs.mkdirSync(dataDir(), { recursive: true });
      const dbPath = path.join(dataDir(), "drama.db");
      const db = fs.existsSync(dbPath)
        ? new sql.Database(fs.readFileSync(dbPath))
        : new sql.Database();
      initSchema(db);
      return db;
    })();
  }
  return _ready;
}

function initSchema(db: Database): void {
  // 目前仅一张配置表: 记录数据存放路径等全局配置
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'");
  if (!tables.length || !tables[0].values.length) {
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT DEFAULT ''
      );
    `);
    db.run("INSERT INTO settings(key,value) VALUES(?,?)", ["data_path", dataDir()]);
    db.run("INSERT INTO settings(key,value) VALUES(?,?)", ["db_path", path.join(dataDir(), "drama.db")]);
    void persist();
  }
  // 剧本表: 名称 + 文件路径 + 内容(提示词/文件文本) + 时间戳
  db.run(`
    CREATE TABLE IF NOT EXISTS scripts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      file_path  TEXT DEFAULT '',
      content    TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // 旧库迁移: 已建的 scripts 表缺 content 列时补上
  try {
    const cols = db.exec("PRAGMA table_info(scripts)")[0]?.values.map((r) => r[1]);
    if (cols && !cols.includes("content")) db.run("ALTER TABLE scripts ADD COLUMN content TEXT DEFAULT ''");
  } catch { /* ignore */ }

  // 图片表: 人物/场景等模块共用图片资源
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT NOT NULL,
      name        TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);

  // 人物表: 名称 + 身份(JSON数组) + 提示词 + 图片ids(JSON数组, 关联 images 表)
  db.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      identity   TEXT DEFAULT '[]',
      prompt     TEXT DEFAULT '',
      image_ids  TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 场景表/产品表: 与人物同构(保存类型标签用 identity 列名统一, JSON数组)
  for (const t of ["scenes", "products"]) {
    db.run(`
      CREATE TABLE IF NOT EXISTS ${t} (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        identity   TEXT DEFAULT '[]',
        prompt     TEXT DEFAULT '',
        image_ids  TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
}

/** 读取配置项 */
export async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const r = queryOne(db, "SELECT value FROM settings WHERE key=?", [key]);
  return (r ? (r.value as T) : fallback);
}

/** 写入配置项 */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  db.run(
    "INSERT INTO settings(key,value) VALUES(?,?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, value]
  );
  await persist();
}