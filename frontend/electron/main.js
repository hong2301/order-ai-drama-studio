// AI视频工坊 Electron 壳
// dev:   加载 http://127.0.0.1:3171 (后端由 npm run dev 拉起)
// prod:  拉起 resources/backend/drama-backend.exe, 等待就绪后加载 out/index.html
// 端口与环境变量同源: 根 .env 的 BACKEND_PORT / FRONTEND_PORT (默认 8031 / 3171)
const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFileSync } = require('child_process')

const APP_ENV = process.env.DRAMA_ENV || (app.isPackaged ? 'prod' : 'dev')
const isDev = APP_ENV !== 'prod'
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8031)
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3171)

let backendProc = null
let mainWindow = null

// ---------- 单实例 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ---------- 日志 -> <data>/logs/main.log ----------
function dataDir() {
  if (isDev) return path.join(__dirname, '..', '..', 'data')
  return path.join(path.dirname(app.getPath('exe')), 'data')
}
function log(msg) {
  try {
    const dir = path.join(dataDir(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'main.log'), `[${new Date().toISOString()}] ${msg}\n`)
  } catch (e) {}
}

// ---------- 后端进程管理(prod) ----------
async function startBackend() {
  if (isDev) { log('dev: 后端由 npm run dev 启动, 跳过拉起'); return }
  try {
    const resp = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`)
    if (resp.ok) { log('检测到已有后端, 复用'); backendProc = { pid: -1, killed: true }; return }
  } catch (e) { /* 未启动, 正常拉起 */ }
  const exe = path.join(process.resourcesPath, 'backend', 'drama-backend.exe')
  log(`启动后端: ${exe}`)
  backendProc = spawn(exe, [], {
    env: {
      ...process.env,
      DRAMA_ENV: APP_ENV,
      BACKEND_PORT: String(BACKEND_PORT),
      DRAMA_DATA_DIR: dataDir(),
      DRAMA_PARENT_PID: String(process.pid),
    },
    windowsHide: true,
    stdio: ['ignore', fs.openSync(path.join(dataDir(), 'logs', 'backend.log'), 'a'),
            fs.openSync(path.join(dataDir(), 'logs', 'backend.log'), 'a')],
  })
  backendProc.on('error', (err) => log(`后端启动失败: ${err.message}`))
  backendProc.on('exit', (c, s) => log(`后端退出 code=${c} signal=${s}`))
  log(`后端已拉起 pid=${backendProc.pid}`)
}
function waitForBackend(timeoutMs = 45000) {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const tick = async () => {
      if (Date.now() - t0 > timeoutMs) return resolve(false)
      try {
        const r = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`)
        if (r.ok) return resolve(true)
      } catch (e) {}
      setTimeout(tick, 500)
    }
    tick()
  })
}
function killBackend() {
  if (!backendProc || backendProc.killed) return
  try {
    execFileSync('taskkill', ['/pid', String(backendProc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch (e) {}
  backendProc = null
}
app.on('before-quit', killBackend)

// ---------- 窗口状态记忆 ----------
function windowStateFile() { return path.join(app.getPath('userData'), 'window-state.json') }
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
    const { screen } = require('electron')
    const wa = screen.getPrimaryDisplay().workArea
    if (s.width && s.height && s.width <= wa.width && s.height <= wa.height) {
      return { width: s.width, height: s.height, x: s.x, y: s.y }
    }
  } catch (e) {}
  return { width: 1380, height: 820 }
}
function saveWindowState(win) {
  try { fs.writeFileSync(windowStateFile(), JSON.stringify(win.getNormalBounds())) } catch (e) {}
}

function createWindow() {
  const state = loadWindowState()
  const win = new BrowserWindow({
    ...state,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  mainWindow = win
  win.on('close', () => saveWindowState(win))
  win.webContents.on('render-process-gone', (e, d) => {
    log(`渲染进程崩溃: ${d.reason}`)
    try { win.reload() } catch (e2) {}
  })
  // 导航拦截: 本地放行, 外部交给系统浏览器, file:// 重写回 out/
  win.webContents.on('will-navigate', (event, urlStr) => {
    if (urlStr.startsWith('http://localhost') || urlStr.startsWith('http://127.0.0.1')) return
    if (urlStr.startsWith('file:')) {
      try {
        const u = new URL(urlStr)
        let page = u.pathname.replace(/^\//, '')
        let m = page.match(/^[a-zA-Z]:\/([a-z0-9_-]+)$/)
        if (!m) m = page.match(/[\/]([a-z0-9_-]+\.html?)$/i)
        if (m) {
          const base = /^[a-z0-9_-]+\.html?$/i.test(m[1]) ? m[1] : m[1] + '.html'
          event.preventDefault()
          win.loadFile(path.join(__dirname, 'out', base), { search: u.search.slice(1) })
          return
        }
        if (page === 'index.html' || page === '') {
          event.preventDefault()
          win.loadFile(path.join(__dirname, 'out', 'index.html'), { search: u.search.slice(1) })
          return
        }
        event.preventDefault()
        return
      } catch (e) {}
    }
    event.preventDefault()
    shell.openExternal(urlStr)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(`http://127.0.0.1:${FRONTEND_PORT}`)
  } else {
    win.loadFile(path.join(__dirname, 'out', 'index.html'))
  }
}

app.whenReady().then(async () => {
  if (!isDev) {
    await startBackend()
    const ok = await waitForBackend()
    log(ok ? '后端就绪' : '警告: 等待后端超时')
  }
  createWindow()
  log('主窗口已创建')
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })