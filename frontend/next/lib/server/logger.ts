// 轻量日志: 控制台(dev) + 文件 <data>/logs/app.log(打包版无终端以文件为准)
import fs from "fs";
import path from "path";
import { dataDir } from "./db";

const LEVEL: Record<string, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const _min = LEVEL[process.env.DRAMA_LOG_LEVEL || "INFO"] || 20;

function write(level: string, msg: string) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  if (LEVEL[level] >= _min) {
    if (process.env.NODE_ENV !== "production" || !process.env.DRAMA_SILENT_CONSOLE) {
      // dev 终端可见
      try { console.log(line.trimEnd()); } catch { /* ignore */ }
    }
    try {
      const dir = path.join(dataDir(), "logs");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "app.log"), line);
    } catch { /* 日志目录不可用时静默 */ }
  }
}

export const logger = {
  debug: (m: string, ...a: unknown[]) => write("DEBUG", fmt(m, a)),
  info: (m: string, ...a: unknown[]) => write("INFO", fmt(m, a)),
  warn: (m: string, ...a: unknown[]) => write("WARN", fmt(m, a)),
  error: (m: string, ...a: unknown[]) => write("ERROR", fmt(m, a)),
};

function fmt(m: string, a: unknown[]): string {
  if (!a.length) return m;
  try {
    let i = 0;
    return m.replace(/%[sdjof]/g, () => {
      const v = a[i++];
      if (typeof v === "object") return safeStringify(v);
      return String(v ?? "");
    });
  } catch { return m; }
}
function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}