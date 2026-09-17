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
  // 跨平台: 不写死 shell(Node 在 win 默认 cmd.exe, unix 默认 /bin/sh)
  execSync(cmd, { cwd, stdio: 'inherit' })
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

// 产物目录: electron-builder 按平台/架构命名(win-unpacked / win-arm64-unpacked, mac / mac-arm64 / mac-universal)
function findBuildDir(prefix) {
  if (!fs.existsSync(RELEASE_BUILD)) return null
  for (const name of fs.readdirSync(RELEASE_BUILD)) {
    const p = path.join(RELEASE_BUILD, name)
    if (!fs.statSync(p).isDirectory()) continue
    if (name === prefix || name.startsWith(prefix + '-')) return p
  }
  return null
}

const PACK_NAME = 'AI视频工坊'
const winDir = plat === 'win32' ? findBuildDir('win') : null
const macDir = plat === 'darwin' ? findBuildDir('mac') : null
// mac 的 .app 在 mac* 目录下(名字随 productName)
const macApp = macDir
  ? path.join(macDir, fs.readdirSync(macDir).find((n) => n.endsWith('.app')) || `${PACK_NAME}.app`)
  : null
if (plat === 'win32' && !winDir) throw new Error('electron-builder 未输出 win-unpacked 目录')
if (plat === 'darwin' && (!macApp || !fs.existsSync(macApp))) throw new Error('electron-builder 未输出 .app')

// ---------- 5) 组装 release/ ----------
if (clean) rmdir(RELEASE)
fs.mkdirSync(RELEASE, { recursive: true })
if (plat === 'win32') {
  for (const item of fs.readdirSync(winDir)) {
    const src = path.join(winDir, item)
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
// Key 已存数据库(界面设置), 打包不再复制 .env(避免密钥打进分发产物); 清掉历史残留
const envRelease = path.join(RELEASE, '.env')
if (fs.existsSync(envRelease)) fs.rmSync(envRelease, { force: true })
const outName = plat === 'darwin' ? `${PACK_NAME}.app` : plat === 'win32' ? `${PACK_NAME}.exe` : PACK_NAME
console.log('\n✅ 打包完成:', path.join(RELEASE, outName))

function ccp(base, name, dst) {
  console.log(`copy ${name} -> ${path.relative(ROOT, dst)}`)
  fs.copyFileSync(path.join(base, name), path.join(dst, name))
}