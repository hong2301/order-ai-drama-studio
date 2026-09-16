// AI视频工坊 Windows 离线打包脚本(网络访问不了 GitHub 时用)
// 与 build.js 流程一致, 唯一区别: electron-builder 使用本地缓存的 Electron zip(electronDist), 不联网下载
// 用法: node scripts/build-offline.js [--clean]
// 缓存位置: %LOCALAPPDATA%/electron/Cache/<hash>/electron-v<版本>-win32-x64.zip(由 npm install electron 自动产生)
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const NEXT = path.join(ROOT, 'next')
const ELECTRON = path.join(ROOT, 'electron')
const SERVER_BUILD = path.join(ELECTRON, 'next-server-build')
const RELEASE_BUILD = path.join(ROOT, 'release-build')
const RELEASE = path.join(ROOT, 'release')

const clean = process.argv.includes('--clean')

function sh(cmd, cwd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}
function rmdir(p) { fs.rmSync(p, { recursive: true, force: true }) }
function copy(src, dst) {
  console.log(`copy ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dst)}`)
  fs.cpSync(src, dst, { recursive: true })
}

// ---------- 0) 找本地 Electron zip 缓存(版本须与已安装的 electron 包一致) ----------
function findElectronZip() {
  let want = ''
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON, 'node_modules', 'electron', 'package.json'), 'utf8'))
    want = pkg.version || ''
  } catch { /* ignore */ }
  console.log(`需匹配的 Electron 版本: ${want || '任意'}`)
  const env = process.env.ELECTRON_CACHE
  const candidates = []
  if (env) candidates.push(env)
  candidates.push(
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache'),
  )
  for (const base of candidates) {
    if (!base || !fs.existsSync(base)) continue
    for (const sub of fs.readdirSync(base)) {
      const p = path.join(base, sub)
      if (!fs.statSync(p).isDirectory()) continue
      for (const f of fs.readdirSync(p)) {
        const m = /^electron-v([\d.]+)-win32-x64\.zip$/.exec(f)
        if (!m) continue
        if (want && m[1] !== want) continue // 版本不一致的缓存跳过(避免误用旧版本)
        const full = path.join(p, f)
        console.log(`找到本地 Electron zip: ${full}`)
        return { dir: p, file: full }
      }
    }
  }
  return null
}

// ---------- 1) next build (standalone) ----------
sh('npm run build', NEXT)
const standaloneRoot = path.join(NEXT, '.next', 'standalone')
if (!fs.existsSync(standaloneRoot)) throw new Error('缺少 .next/standalone, next build 未输出服务器')

// ---------- 2) 收整 next-server-build(拍平: server.js 置于根) ----------
function findServerJs(dir, depth = 0) {
  if (depth > 4) return null
  let hit = null
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) {
      hit = findServerJs(p, depth + 1)
      if (hit) return hit
    } else if (name === 'server.js') {
      return p
    }
  }
  return null
}
const serverJs = findServerJs(standaloneRoot)
if (!serverJs) throw new Error('standalone 中未找到 server.js')
const serverDir = path.dirname(serverJs)

if (clean) rmdir(SERVER_BUILD)
fs.mkdirSync(SERVER_BUILD, { recursive: true })
for (const item of fs.readdirSync(serverDir)) {
  const src = path.join(serverDir, item)
  const dst = path.join(SERVER_BUILD, item)
  rmdir(dst)
  fs.cpSync(src, dst, { recursive: true })
}
const staticSrc = path.join(NEXT, '.next', 'static')
if (fs.existsSync(staticSrc)) copy(staticSrc, path.join(SERVER_BUILD, '.next', 'static'))
const publicSrc = path.join(NEXT, 'public')
if (fs.existsSync(publicSrc)) copy(publicSrc, path.join(SERVER_BUILD, 'public'))
console.log('next-server-build 收整完成:', SERVER_BUILD)

// ---------- 3) electron-builder 套壳(离线: 用本地 zip) ----------
const zip = findElectronZip()
if (!zip) throw new Error('未找到匹配的本地 Electron zip 缓存(%LOCALAPPDATA%/electron/Cache), 请先 npm install electron')
sh(`npx electron-builder --win -c.electronDist="${zip.dir}"`, ELECTRON)

// ---------- 4) 组装 release/ ----------
if (clean) rmdir(RELEASE)
fs.mkdirSync(RELEASE, { recursive: true })
const winDir = path.join(RELEASE_BUILD, 'win-unpacked')
if (!fs.existsSync(winDir)) throw new Error('electron-builder 未输出 win-unpacked')
for (const item of fs.readdirSync(winDir)) {
  const src = path.join(winDir, item)
  const dst = path.join(RELEASE, item)
  rmdir(dst)
  fs.cpSync(src, dst, { recursive: true })
}

const nextServerDst = path.join(RELEASE, 'resources', 'next-server')
rmdir(nextServerDst)
fs.mkdirSync(nextServerDst, { recursive: true })
for (const item of fs.readdirSync(SERVER_BUILD)) {
  copy(path.join(SERVER_BUILD, item), path.join(nextServerDst, item))
}
const wasmSrc = path.join(NEXT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
const wasmDst = path.join(nextServerDst, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
if (fs.existsSync(wasmSrc)) {
  fs.mkdirSync(path.dirname(wasmDst), { recursive: true })
  fs.copyFileSync(wasmSrc, wasmDst)
  console.log('copy sql-wasm.wasm -> next-server/node_modules/sql.js/dist/')
}
if (fs.existsSync(path.join(ROOT, '.env'))) {
  fs.copyFileSync(path.join(ROOT, '.env'), path.join(RELEASE, '.env'))
  console.log('copy .env -> release')
}
fs.mkdirSync(path.join(RELEASE, 'data'), { recursive: true })
console.log('\n✅ 离线打包完成:', path.join(RELEASE, 'AI视频工坊.exe'))