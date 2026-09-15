// AI视频工坊 Electron 壳(TypeScript)
// dev:   加载 http://127.0.0.1:3171 (Next 全栈由根 npm run dev 一起拉起)
// prod:  加载 exe 同级 .env -> 启动 resources/next-server 的 standalone 服务器 -> loadURL(3171)
import { app, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3171);
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// ---------- 单实例 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- 数据目录(正式版 = exe 同级 data) ----------
function dataDir(): string {
  if (isDev) return path.join(__dirname, "..", "..", "data");
  return path.join(path.dirname(app.getPath("exe")), "data");
}

function log(msg: string): void {
  try {
    const dir = path.join(dataDir(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "main.log"), `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

// ---------- 加载 exe 同级 .env(打包脚本复制根 .env 到 release/) ----------
function loadEnvFile(envPath: string): void {
  try {
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1] !== "NODE_ENV" && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* ignore */ }
}

function waitForServer(timeoutMs = 60000): Promise<boolean> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = async (): Promise<void> => {
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      try {
        const r = await fetch(`http://127.0.0.1:${FRONTEND_PORT}/api/health`);
        if (r.ok) return resolve(true);
      } catch { /* not ready */ }
      setTimeout(tick, 500);
    };
    void tick();
  });
}

// ---------- 生产: 启动 next standalone 服务器(Electron 内置 Node, 用户无需安装) ----------
function startNextServer(): boolean {
  const serverJs = path.join(process.resourcesPath, "next-server", "server.js");
  if (!fs.existsSync(serverJs)) {
    log(`next-server 缺失: ${serverJs}`);
    return false;
  }
  process.env.PORT = String(FRONTEND_PORT);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NODE_ENV = "production";
  process.env.DRAMA_DATA_DIR = dataDir();
  log(`启动 next standalone: ${serverJs}`);
  // standalone server.js 自带 http 服务器, 与主进程共存
  require(serverJs);
  return true;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#f7f7f7",
    icon: path.join(__dirname, "..", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow = win;
  win.on("closed", () => { mainWindow = null; });
  win.webContents.on("render-process-gone", (_e, d) => {
    log(`渲染进程崩溃: ${d.reason}`);
    try { win.reload(); } catch { /* ignore */ }
  });
  void win.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`);
}

app.whenReady().then(async () => {
  if (!isDev) {
    // 生产: 读 exe 同级 .env + 启动 next server + 等就绪
    loadEnvFile(path.join(path.dirname(app.getPath("exe")), ".env"));
    startNextServer();
    const ok = await waitForServer();
    log(ok ? "next 服务器就绪" : "警告: next 服务器等待超时");
  } else {
    log("dev 模式: Next 由根 npm run dev 启动");
  }
  createWindow();
  log(`主窗口已创建 (${isDev ? "dev" : "prod"})`);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});