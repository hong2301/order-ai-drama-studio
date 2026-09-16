# AI视频工坊 (AI Video Studio)

豆包 AI 视频生成工作台 — Next.js 全栈 + Electron 套壳（TypeScript）。

> 从剧本到成片的一站式工作台：写剧本 → 建人物/场景/产品 → 生成视频 → 成片入库。

## 功能模块

| 模块 | 说明 |
|---|---|
| **AI 对话** | 带项目上下文的助手：整理/提取剧本、写资料库、直接发起视频生成；支持图片/视频/文档附件、多会话、模型切换 |
| **剧本库** | 一集一个剧本（md/txt/docx 导入或粘贴）；AI 自动解析出 人物/场景/产品 + 分辨率/时长/比例/关键词，并识别剧本内图片匹配到资料库 |
| **控制台** | 选视频模型 + 分辨率/画面比例/时长 → 开始生成；生成前自动做**物料一致性检查与剧情适配** |
| **视频库** | 生成中占位 → 成片封面卡片；点击大播放器、右键删除、滚动加载、按完成时间排序；视频自动本地落盘持久保存 |
| **资料库** | 人物 / 场景 / 产品三库：名称+身份标签+提示词+图片；**同名自动去重合并**（名称容错 + 提示词 AI 融合） |

## 视频模型（火山方舟 Seedance）

| 模型 | 能力 | 参考价 |
|---|---|---|
| Seedance 1.0 Pro / Pro Fast | 文生/图生视频，**无声**，时长 ≤12 秒 | ¥0.34 / ¥0.09 每秒 |
| Seedance 2.0 Mini / Fast | 支持**人物台词/旁白**（提示词写「人物台词：xxx」） | ¥0.2 / ¥0.6 每秒 |
| Seedance 2.0 标准版 / 2.5 | 会员档：台词、口型、配音可控性更强 | 会员订阅 |

- 模型需先在火山方舟控制台开通（未开通会报 `ModelNotOpen`）
- 价格以方舟计费页为准；新增模型 = `next/lib/server/video/registry.ts` 加一行
- 架构支持多商家（`VideoProvider` 接口），接入海螺/可灵等只需新增一个 provider

## 项目结构

```
ai视频工坊/
├── package.json        # 根命令: dev / build
├── AGENTS.md           # ★开发索引(改代码前先读)
├── .env                # 环境变量(不入库; 顶栏「API Key」按钮可改)
├── next/               # ★全栈: 页面 + 全部 /api + SQLite
│   ├── app/components/ # 对话/剧本/控制台/资料库/视频库/Key设置
│   ├── app/api/        # chat · scripts · characters/scenes/products · video/* · models · settings
│   └── lib/server/     # db · doubao · chatSystem · library · scriptParse · video/*
├── electron/           # Electron 壳(TS): dev 加载 3171; prod 启动 next standalone
├── scripts/build.js    # 打包流水线
├── data/               # 开发数据目录(数据库/上传/视频/日志, gitignore)
└── release/            # 打包产物(gitignore)
```

## 命令

```bash
npm run dev      # 一键: Next 全栈(3171) + Electron 窗口
npm run build    # 打包: next build(standalone) → 套壳 → 组装 release/
```

## 环境变量（根 .env）

| 变量 | 说明 |
|---|---|
| `DOUBAO_API_KEY` | 火山方舟 API Key（也可在界面顶栏按钮里改，即时生效） |
| `DOUBAO_CHAT_MODEL` | 默认对话/解析模型（默认 doubao-seed-2-0-mini-260428） |

## 数据（SQLite / sql.js）

- 开发：`data/drama.db`；正式版：win = exe 同级 `data/`，mac = `~/Library/Application Support/AI视频工坊/data`
- 表：`scripts`（剧本，含解析字段与物料指纹）、`characters`/`scenes`/`products`（三库，含 `name_key` 去重键）、`images`、`video_tasks`、`settings`
- 上传/产物目录：`data/uploads/{chat,scripts,scripts_imgs,videos}/`

## 开发说明

- 端口 3171（dev 与正式版一致）；`next.config.ts` 解析根 `.env` 并注入 `DRAMA_DATA_DIR`
- AI 对话的系统上下文与剧本输出规范在 `next/lib/server/chatSystem.ts`
- 剧本输出采用**分镜表**格式（时间 | 画面与对白），提示词走"动作驱动 + 人物台词：xxx"以适配视频模型
- `.env`、`data/`、`release/` 均不入库；GitHub 推送走 SSH over 443

```bash
git clone git@ssh.github.com:443/hong2301/order-ai-drama-studio.git   # HTTPS 直连易超时
cd order-ai-drama-studio && cp .env.example .env   # 填 DOUBAO_API_KEY
npm run dev
```

---
更多细节（目录地图、常见改动速查、已知坑）见 **[AGENTS.md](AGENTS.md)**。
