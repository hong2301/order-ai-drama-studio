# AI视频工坊 — 开发索引

豆包(火山方舟) AI 视频生成工作台。Next 全栈(页面 + API + SQLite) + Electron 套壳(TS)。
**改代码前先读本文件**，通常不用再全仓搜索。

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端 | Next(webpack) + React + antd | 16.3.5 / 19.3.0 / 6.6.4 |
| 后端 | Next Route Handlers(与页面同进程) | — |
| 数据库 | sql.js(纯 WASM SQLite) | 1.14.2 |
| 桌面壳 | Electron(TS → dist/main.js) | 44.3.0 |

## 目录地图

```
根
├─ package.json                   一键 dev / build(concurrently 拉 next + electron)
├─ .env                           ★唯一环境变量文件(DOUBAO_API_KEY / DOUBAO_CHAT_MODEL)
├─ scripts/build.js               打包流水线(next build → 套壳 → release/)
├─ data/                          dev 数据库 + 上传文件(gitignore)
├─ next/                          ★全栈: 页面 + 全部 /api
│  ├─ next.config.ts              解析根 .env、注入 DRAMA_DATA_DIR、allowedDevOrigins
│  ├─ app/layout.tsx              根布局 + 黑白主题(blackWhiteTheme.token)
│  ├─ app/page.tsx                head(logo/刷新) + body(模块横向排列) ← 新模块加这
│  ├─ app/components/ChatModule.tsx   AI 对话模块(气泡/附件/发送)
│  ├─ app/globals.css             全局样式(一体输入框去边框、滚动条)
│  ├─ app/api/chat/route.ts       POST 对话(调豆包, 最多 9 张图)
│  ├─ app/api/health/route.ts     GET 健康检查(Electron 等就绪用)
│  ├─ app/api/settings/route.ts   GET settings 表
│  ├─ app/api/upload/route.ts     POST 图片上传 → data/uploads/<folder>/
│  ├─ app/api/uploads/[folder]/[name]/route.ts   上传文件读取
│  ├─ lib/server/db.ts            SQLite 封装(getDb/queryAll/getSetting/persist)
│  └─ lib/server/doubao.ts        豆包客户端(chat() / DoubaoError)
└─ electron/main.ts               壳主进程(dev 直连 3171; prod 起 standalone server)
```

## 常见改动速查

| 想做什么 | 改哪里 |
|---|---|
| 加新模块(人物/场景/产品库等) | `next/app/page.tsx` body 里追加组件; 组件放 `next/app/components/` |
| 加新接口 | 新建 `next/app/api/<name>/route.ts`, 用 `@/lib/server/db` 读写 |
| 加数据库表 | `next/lib/server/db.ts` 的 `initSchema()` |
| 改主题色/圆角 | `next/app/layout.tsx` 的 `blackWhiteTheme.token` |
| 改 AI 请求参数/模型调用 | `next/lib/server/doubao.ts` 的 `chat()` |
| 改对话区 UI | `next/app/components/ChatModule.tsx` |
| 改窗口尺寸/标题/菜单 | `electron/main.ts` 的 `createWindow()` |
| 改打包流程/产物结构 | `scripts/build.js` |

## 关键约定

- **端口 3171**：dev 与正式版一致，Electron 写死
- **环境变量**：只有根 `.env`；`next.config.ts` 启动时手动解析注入(不是 Next 自带 dotenv)，**改完必须重启 dev**
- **数据目录**：dev = `<root>/data/`(由 `next.config.ts` 注入 `DRAMA_DATA_DIR`)；正式版 win = exe 同级 `data/`，mac = `~/Library/Application Support/AI视频工坊/data`
- **数据库**：sql.js 纯 WASM —— 内存操作 + 写后全量 `persist()` 落盘到 `data/drama.db`(可选 `queryAll`/`queryOne`/`getSetting`/`setSetting`)
- **路径别名**：`@/*` → `next/`
- **UI 风格**：黑白灰极简；模块从左到右排列、无标题；head 是 logo + 刷新
- **Electron dev**：next HMR 经 `127.0.0.1` 访问，`next.config.ts` 已配 `allowedDevOrigins`
- `next/AGENTS.md`、`next/CLAUDE.md` 由 `next dev` 自动生成/改写，不用手改
- 改前端后按全局规则截图到 `~/Desktop/now.png` 验证

## 常用命令

```bash
npm run dev              # 一键: next(3171) + electron 窗口
npm run build            # 打包 release/
cd next && npm run dev   # 只跑全栈(浏览器调试 UI 时用)
curl -s http://127.0.0.1:3171/api/health
```

## 已知坑

1. **Electron「卡死」多半是二进制没装好**：`node_modules/electron/dist/` 缺 `Electron.app`，或 `path.txt` 缺失时，`index.js` 会反复触发下载并把进程挂住(表现为 `--version` 都无响应)。修复：解压官方 zip 到 `dist/`，并写入 `path.txt`(内容 `Electron.app/Contents/MacOS/Electron`)。
2. **`scripts/build.js` 仍有 Windows 写法**：`execSync(..., shell: 'cmd.exe')` 和结尾硬编码 `.exe` 路径，在 macOS 上 `npm run build` 会失败(README 声称已跨平台，实际没改干净)。
3. **`/api/chat` 的 images 是 URL 不是图片**：前端传 `/api/uploads/...`，服务端读文件转 data URL 再发给豆包(单图 ≤10MB，最多 9 张)。
4. **改依赖后要检查原生二进制**：`electron/` 与 `next/` 各自独立 `node_modules`，根目录只装 concurrently。
