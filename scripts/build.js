// AI视频工坊 打包脚本: npm run build
// 流程: next build(standalone) -> 收整 next-server-build -> rebuild 原生模块(Electron ABI)
//       -> electron-builder(套壳) -> 组装 release/ 目录
// 用法: node scripts/build.js [--clean]
const fs = require('fs')
const path = require('path')
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
  execSync(cmd, { cwd, stdio: 'inherit', shell: 'cmd.exe' })
}
function rmdir(p) { fs.rmSync(p, { recursive: true, force: true }) }
function copy(src, dst) {
  console.log(`copy ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dst)}`)
  fs.cpSync(src, dst, { recursive: true })
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
// 静态资源(.next/static) + public
const staticSrc = path.join(NEXT, '.next', 'static')
if (fs.existsSync(staticSrc)) copy(staticSrc, path.join(SERVER_BUILD, '.next', 'static'))
const publicSrc = path.join(NEXT, 'public')
if (fs.existsSync(publicSrc)) copy(publicSrc, path.join(SERVER_BUILD, 'public'))

// ---------- 3) 原生模块: 无(sql.js 纯 WASM, dev/Electron ABI 同构, 无需 rebuild) ----------

// ---------- 4) electron-builder 套壳打包(按平台) ----------
const plat = process.platform
const target = plat === 'win32' ? '--win' : plat === 'darwin' ? '--mac' : '--linux'
sh(`npx electron-builder ${target}`, ELECTRON)
// 产物目录
const PACK_NAME = 'AI视频工坊'
const winUnpacked = path.join(RELEASE_BUILD, 'win-unpacked')
const macApp = path.join(RELEASE_BUILD, 'mac', `${PACK_NAME}.app`)
if (plat === 'win32' && !fs.existsSync(winUnpacked)) throw new Error('electron-builder 未输出 win-unpacked')
if (plat === 'darwin' && !fs.existsSync(macApp)) throw new Error('electron-builder 未输出 .app')

// ---------- 5) 组装 release/ ----------
if (clean) rmdir(RELEASE)
fs.mkdirSync(RELEASE, { recursive: true })
if (plat === 'win32') {
  for (const item of fs.readdirSync(winUnpacked)) {
    const src = path.join(winUnpacked, item)
    const dst = path.join(RELEASE, item)
    rmdir(dst)
    fs.cpSync(src, dst, { recursive: true })
  }
} else if (plat === 'darwin') {
  // mac: 整体 .app + Resources 内资源
  const dstApp = path.join(RELEASE, `${PACK_NAME}.app`)
  if (!fs.existsSync(dstApp)) fs.cpSync(macApp, dstApp, { recursive: true })
}

// 收集服务器资源(win: release/resources/next-server; mac: .app/Contents/Resources/next-server)
let resRoot = path.join(RELEASE, 'resources')
if (plat === 'darwin') resRoot = path.join(RELEASE, `${PACK_NAME}.app`, 'Contents', 'Resources')
const nextServerDst = path.join(resRoot, 'next-server')
fs.mkdirSync(path.join(RELEASE, 'data'), { recursive: true })

rmdir(nextServerDst)
fs.mkdirSync(nextServerDst, { recursive: true })
for (const item of fs.readdirSync(SERVER_BUILD)) {
  copy(path.join(SERVER_BUILD, item), path.join(nextServerDst, item))
}
// sql.js 的 wasm: Next standalone trace 不收集非 JS 资源, 需手动补拷(否则正式版数据库无法初始化)
const wasmSrc = path.join(NEXT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
const wasmDst = path.join(nextServerDst, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
if (fs.existsSync(wasmSrc)) {
  fs.mkdirSync(path.dirname(wasmDst), { recursive: true })
  fs.copyFileSync(wasmSrc, wasmDst)
  console.log('copy sql-wasm.wasm -> next-server/node_modules/sql.js/dist/')
}
// 复制根 .env(exe 同级, Electron 启动时加载)
if (fs.existsSync(path.join(ROOT, '.env'))) {
  ccp(ROOT, '.env', RELEASE)
}
console.log('\n✅ 打包完成:', path.join(RELEASE, 'AI视频工坊.exe'))

function ccp(base, name, dst) {
  console.log(`copy ${name} -> ${path.relative(ROOT, dst)}`)
  fs.copyFileSync(path.join(base, name), path.join(dst, name))
}