# AI视频工坊 (AI Video Studio)

豆包视频生成工作台 — Next.js 全栈 + Electron 套壳（TypeScript）。

## 项目结构

```
ai视频/
├── package.json        # 根命令: dev / build
├── .env                # ★ 全项目唯一环境变量文件(项目根; 打包时复制到 release/)
├── next/               # ★ 全栈: 页面 + 全部 /api (SQLite 数据库)
│   ├── app/            #   layout/page(黑白主题) + api/chat, api/settings, api/health
│   └── lib/server/     #   db(better-sqlite3) / doubao 客户端
├── electron/           # Electron 壳(TS): dev 加载 3171; prod 启动 next standalone
├── scripts/build.js    # 打包流水线
├── data/               # 开发数据库目录(项目根 data/, 正式版 = exe 同级 data/)
└── release/            # 打包产物(正式版, gitignore)
```

## 命令

```bash
npm run dev      # 一条命令: Next 全栈(3171) + Electron 窗口 一起启动
npm run build    # 打包: next build(standalone) -> 套壳 electron -> 组装 release/
```

## 环境变量（根 .env）

| 变量 | 说明 |
|---|---|
| `DOUBAO_API_KEY` | 豆包(火山方舟 Ark) API Key |
| `DOUBAO_CHAT_MODEL` | AI 对话模型(默认 doubao-seed-2-0-mini-260428) |

- 开发模式：Next 启动时自动读取根 `.env`
- 正式版：打包脚本将 `.env` 复制到 `release/`（exe 同级），Electron 启动前加载

## 数据（SQLite）

- 开发：`data/drama.db`（项目根 data/）
- 正式版：exe 同级 `data/drama.db`（由 Electron 注入 `DRAMA_DATA_DIR`）
- 目前仅一张配置表 `settings`（记录 `data_path` / `db_path`），业务表后续按需扩展
- 接口：`GET /api/settings` 查看配置；数据库引擎：`better-sqlite3`（编码 WAL）

## 页面布局

- head：logo(AI视频工坊 / AI Video Studio) + 刷新
- body：模块从左到右排列、自动填充剩余高度，模块无标题
  - 第一个模块：**AI 对话**（对话区 + 模块底部一体输入框，调 `/api/chat` 接入豆包）
- 无 tail
- 整体主题色：黑白灰极简

## 开发说明

- 端口：Next dev / standalone 均为 3171
- 技术：Next 16.3.1 + React 19 + antd 6 + better-sqlite3（next `serverExternalPackages` 加载原生模块；打包时 `electron-rebuild` 转为 Electron ABI）
- Electron 壳（TS 编译后 dist/main.js）：dev 直连 3171；prod 加载 exe 同级 `.env` → 启动 `resources/next-server` standalone 服务器 → 等待就绪后 loadURL(3171)