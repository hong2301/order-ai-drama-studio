// 一键打包完整桌面应用到 release/
// 流程: next静态导出 -> copy-out -> electron-builder(前端壳) -> PyInstaller(后端) -> 组装 release
// 用法: npm run build | npm run build -- --clean
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const withClean = process.argv.includes('--clean')
const ROOT = path.join(__dirname, '..')
const RELEASE = path.join(ROOT, 'release')

function run(cmd, cwd) {
  console.log(`\n>>> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: cwd || ROOT })
}
function rmdir(p) { fs.rmSync(p, { recursive: true, force: true }) }
function copy(src, dst) {
  console.log(`\n>>> 复制: ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dst)}`)
  rmdir(dst)
  fs.cpSync(src, dst, { recursive: true })
}
// 移动(磁盘紧张的机器避免双份占用)
function move(src, dst) {
  console.log(`\n>>> 移动: ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dst)}`)
  rmdir(dst)
  fs.renameSync(src, dst)
}

function build() {
  // 1) 前端静态导出(next/out)
  run('npm --prefix ../frontend/next run build', path.join(ROOT, 'frontend'))
  // 2) 复制 out -> electron/out
  run('node scripts/copy-out.js', path.join(ROOT, 'frontend'))
  // 3) electron-builder 打包前端壳(frontend/build/win-unpacked)
  run('npm run build', path.join(ROOT, 'frontend', 'electron'))
  // 4) PyInstaller 打包后端(backend/dist/drama-backend)
  run('python build_backend.py', path.join(ROOT, 'backend'))
  // 5) 组装 release/
  rmdir(RELEASE)
  fs.mkdirSync(RELEASE, { recursive: true })
  move(path.join(ROOT, 'frontend', 'build', 'win-unpacked'), RELEASE)
  move(path.join(ROOT, 'backend', 'dist', 'drama-backend'), path.join(RELEASE, 'resources', 'backend'))
  fs.mkdirSync(path.join(RELEASE, 'data'), { recursive: true })
  console.log('\n✅ 打包完成:')
  console.log(`   ${path.join(RELEASE, 'AiDramaStudio.exe')}`)
  console.log('   (首次运行自动在 release/data 建立数据库)')
}

try {
  build()
} catch (e) {
  console.error('\n❌ 打包失败:', e.message)
  process.exit(1)
}