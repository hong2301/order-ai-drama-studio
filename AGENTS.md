# AI视频工坊 — 开发索引

豆包(火山方舟) AI 视频生成工作台。Next 全栈(页面 + API + SQLite) + Electron 套壳(TS)。

> 用户视角的完整操作链路（视频生成 / AI 对话工具调用 / 视频提取剧本 / 三库同名合并融合 / 参考图手绘化）见 **[OPERATION-FLOWS.md](OPERATION-FLOWS.md)**。
> 结构索引见 **[CODEBASE-INDEX.md](CODEBASE-INDEX.md)**。
**改代码前先读本文件**，通常不用再全仓搜索。

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 前端 | Next(webpack) + React + antd | 16.3.5 / 19.3.0 / 6.6.4 |
| 后端 | Next Route Handlers(与页面同进程) | — |
| 数据库 | sql.js(纯 WASM SQLite) | 1.14.2 |
| 桌面壳 | Electron(TS → dist/main.js) | 44.3.0 |
| 模型 | 豆包 Seedance(视频) / Seed(对话·解析) | 火山方舟 API |

## 产品全景（一屏理解）

用户在四个模块里完成「剧本 → 素材 → 生成 → 成片」：
1. **AI 对话**：带项目上下文的助手，可整理/提取剧本、写资料库、直接发起视频生成
2. **剧本库**：一集一个剧本(md/txt/docx)，解析出 人物/场景/产品 + 视频配置；选中剧本联动三库与控制台
3. **控制台**：选视频模型 + 分辨率/比例/时长 → 开始生成(生成前做一致性适配)
4. **视频库**：生成中占位 → 成片封面卡片(播放/右键删除)，视频本地落盘持久保存

## 目录地图

```
根
├─ package.json                   一键 dev / build(concurrently 拉 next + electron)
├─ .env                           ★唯一环境变量文件(DOUBAO_API_KEY / DOUBAO_CHAT_MODEL) — 已 gitignore, 不入库
├─ scripts/build.js               打包流水线(next build → 套壳 → release/)
├─ data/                          dev 数据库 + 上传文件 + 视频 + 日志(gitignore)
│  ├─ drama.db                    SQLite(scripts/characters/scenes/products/images/video_tasks/settings)
│  ├─ uploads/{chat,scripts,scripts_imgs,videos}/  附件/剧本原文件/剧本图/生成的视频
│  └─ logs/{server.log,main.log}  服务端/Electron 日志
├─ next/                          ★全栈: 页面 + 全部 /api
│  ├─ next.config.ts              解析根 .env、注入 DRAMA_DATA_DIR、allowedDevOrigins
│  ├─ app/page.tsx                head(logo/刷新/API Key) + body(模块横向排列) ← 新模块加这
│  ├─ app/components/
│  │  ├─ ChatModule.tsx           AI 对话(会话列表/附件/模型切换)
│  │  ├─ ScriptModule.tsx         剧本库(上传/分镜/联动/视频库入口)
│  │  ├─ ConsoleModule.tsx        控制台(模型/分辨率/比例/时长/开始生成)
│  │  ├─ InfoCardModule.tsx       资料库通用组件(人物/场景/产品)
│  │  ├─ VideoLibraryModal.tsx    视频库弹窗(封面卡片/播放器/右键删除/滚动加载)
│  │  └─ KeySettings.tsx          顶栏 API Key 设置(即时生效 + 写 .env)
│  ├─ app/api/
│  │  ├─ chat/                    对话: 注入系统上下文 + 工具(剧本/资料库/视频转剧本/直接生成)
│  │  ├─ scripts/                 剧本 CRUD + upload + [id]/parse(解析) + batch-delete
│  │  ├─ characters|scenes|products/   三库 CRUD(走统一去重合并)
│  │  ├─ library/dedupe           三库历史重复清理(合并同名 + 剧本引用重指向)
│  │  ├─ video/generate           创建生成任务(带 scriptId 时先一致性适配)
│  │  ├─ video/tasks[/id]         任务列表(分页) / 刷新(拉状态+视频本地化) / 删除
│  │  ├─ video/models             视频模型注册表(只下发可用)
│  │  ├─ models[/select]          对话模型(自动探测已开通) + 选择同步到 settings
│  │  ├─ settings/key             API Key 读取/修改
│  │  └─ upload(s)/               文件上传 + 读取(/api/uploads/<folder>/<name>)
│  └─ lib/server/
│     ├─ db.ts                    SQLite(getDb/queryAll/queryOne/getSetting/persist/normName)
│     ├─ doubao.ts                豆包客户端 chat(): 文本/图片/视频 + 工具调用循环(≤6轮)
│     ├─ chatSystem.ts            ★AI 对话系统提示词(项目上下文/能力/剧本输出规范)
│     ├─ library.ts               ★三库去重融合(名称归一化匹配/提示词AI融合/历史清理)
│     ├─ scriptParse.ts           剧本解析(人物/场景/产品/清晰度/时长/比例/关键词 + 图片匹配)
│     └─ video/
│        ├─ types.ts              VideoProvider 接口 + 任务/模型定义
│        ├─ registry.ts           ★视频模型注册表(加模型只改这) + 能力预设(presets)
│        ├─ providers/doubao.ts   火山方舟适配(content 组装/参数回退容错)
│        ├─ index.ts              任务创建/刷新(视频下载本地化)/列表/删除
│        ├─ modelsProbe.ts        对话模型自动探测(24h 缓存 + 官方费用表) 
│        └─ adapt.ts              生成前一致性检查 + 剧情适配(物料指纹比对)
└─ electron/main.ts               壳主进程(dev 直连 3171; prod 起 standalone server)
```

## 常见改动速查

| 想做什么 | 改哪里 |
|---|---|
| 加视频模型(同一商家) | `lib/server/video/registry.ts` 加一行(状态/能力 presets/价格) |
| 加视频商家(海螺/可灵等) | 新建 `lib/server/video/providers/<商家>.ts` 实现 `VideoProvider`, 在 `registry.ts` 的 `PROVIDERS` 注册 |
| 改 AI 对话行为/剧本格式规范 | `lib/server/chatSystem.ts` 的 `SYSTEM_PROMPT` |
| 改三库去重/合并/融合规则 | `lib/server/library.ts`(`normName`/`upsertLibraryRecord`/`dedupeLibrary`) |
| 改剧本解析提取规则 | `lib/server/scriptParse.ts`(`PARSE_TOOL` 字段 + 解析 prompt) |
| 改生成前一致性适配 | `lib/server/video/adapt.ts`(指令 + `materialsFp` 指纹) |
| 改视频生成参数/容错 | `lib/server/video/providers/doubao.ts` |
| 改对话模型费用 | `lib/server/video/modelsProbe.ts` 的 `CHAT_PRICE` |
| 加新模块 | `app/page.tsx` body 里追加组件; 组件放 `app/components/` |
| 加新接口 | 新建 `app/api/<name>/route.ts`, 用 `@/lib/server/db` 读写 |
| 加数据库表/列 | `lib/server/db.ts` 的 `initSchema()`(sql.js 无 migrations: 幂等 CREATE + PRAGMA/ALTER) |
| 改主题色/圆角 | `app/layout.tsx` 的 `blackWhiteTheme.token` |
| 改窗口尺寸/标题/菜单 | `electron/main.ts` 的 `createWindow()` |
| 改打包流程/产物结构 | `scripts/build.js` |

## 关键约定

- **端口 3171**：dev 与正式版一致，Electron 写死
- **环境变量**：只有根 `.env`；`next.config.ts` 启动时手动解析注入(不是 Next 自带 dotenv)，**改完必须重启 dev**；`.env` 已不入库，运行时可用顶栏「API Key」按钮改(即时生效 + 回写 .env)
- **数据目录**：dev = `<root>/data/`(由 `next.config.ts` 注入 `DRAMA_DATA_DIR`)；正式版 win = exe 同级 `data/`，mac = `~/Library/Application Support/AI视频工坊/data`
- **数据库**：sql.js 纯 WASM —— 内存操作 + 写后全量 `persist()` 落盘到 `data/drama.db`；三库去重键 `name_key`(名称归一化)/`content_key`(名称+提示词)，剧本 `materials_fp`(物料指纹，判断是否需要一致性适配)
- **视频生成链路**：`/api/video/generate` → (有 scriptId 时)物料指纹变化才做一致性适配 → 收集参考图(人物/场景/产品各取首图, 并在提示词里注入「@图像N」对应关系) → `createVideoTask` → 商家 provider 提交 → 轮询 `/api/video/tasks/[id]`(成功后**下载视频到 data/uploads/videos/ 本地化**，因方舟 URL 有时效) → 视频库
- **参考图(全模态参考)**：图片必须放进 `content[]` 并带 `role:"reference_image"`(同时传 `omni_reference_task_type:"reference"`)；仅 Seedance 2.0 系列(≤9 张)/2.5(≤30 张)支持，**1.0 系列不支持**，且与首帧图互斥
- **视频模型能力**：Seedance 1.0 Pro/Fast 无声；Seedance 2.0 Mini/Fast 支持台词/旁白(提示词写「人物台词：xxx」)；时长上限**以模型接口为准**(接口报 "must be less than or equal to N" 时 provider 按该上限重试并回传提示)，`presets.durationMax` 仅供展示/AI 提示参考
- **模型价格**：均为估算/官方刊例(见 registry `pricePerSecond` 与 modelsProbe `CHAT_PRICE`)，以方舟计费页为准
- **AI 对话**：每次会话注入 `chatSystem.ts` 的系统上下文；工具可写剧本库/资料库、把视频提取为剧本、直接创建视频生成任务
- **视频转剧本(video_to_script)**：上传视频 → 模型观看(**对话模型需支持 video 输入**, 如 seed-2.1-pro) → 输出【画面提示词】+ 剧本初稿(**不落库**) → 未尾询问是否入库；可传 duration/ratio/resolution 约束成片；视频已在本轮上下文时不重复传(省体积/降成本)
- **工具装载**：`pickToolsByIntent` 按意图装载(短指令/肯定回应/带视频/带文本附件都有兜底)；模型在**没工具**时会把调用裸写成 `<|FunctionCallBegin|>[...]` 文本 —— route 里已兜底解析(括号配对)+真执行+清洗
- **剧本格式**：一集一故事，含 视频配置/人物/场景/产品/主剧情/**分镜表(时间 | 画面与对白)**/执行要点（规范见 `chatSystem.ts`）
- **UI 风格**：黑白灰极简；模块从左到右排列、无标题；head = logo + 刷新 + API Key
- **antd 6 API**：DropDown 用 `popupRender`(不是 dropdownRender)、Tooltip 用 `styles.container`(不是 overlayInnerStyle)、Modal 用 `destroyOnHidden`
- **git 推送**：GitHub 走 SSH over 443(`ssh://git@ssh.github.com:443/...`)，HTTPS 直连会超时
- `next/AGENTS.md`、`next/CLAUDE.md` 由 `next dev` 自动生成/改写，不用手改

## 常用命令

```bash
npm run dev              # 一键: next(3171) + electron 窗口
npm run build            # 打包 release/
cd next && npm run dev   # 只跑全栈(浏览器调试 UI 时用)
curl -s http://127.0.0.1:3171/api/health
curl -s -X POST http://127.0.0.1:3171/api/library/dedupe   # 三库历史去重清理
```

## 已知坑

1. **Electron「卡死」多半是二进制没装好**：`node_modules/electron/dist/` 缺 `Electron.app`，或 `path.txt` 缺失时，`index.js` 会反复触发下载并把进程挂住(表现为 `--version` 都无响应)。修复：解压官方 zip 到 `dist/`，并写入 `path.txt`(内容 `Electron.app/Contents/MacOS/Electron`)。
2. **`scripts/build.js` 仍有 Windows 写法**：`execSync(..., shell: 'cmd.exe')` 和结尾硬编码 `.exe` 路径，在 macOS 上 `npm run build` 会失败(README 声称已跨平台，实际没改干净)。
3. **时长参数**：方舟只接受**数字** duration(字符串会 InvalidParameter)，且 Seedance 1.0/2.0 上限 12 秒；provider 有参数自动回退(去掉不支持的参数重试)，因此**校验必须在 `createVideoTask` 做**，否则会被静默回退成默认时长。
4. **附件**：`/api/chat` 的 images 里可混视频 URL——服务端按扩展名分流(图片 ≤10MB 转 data URL；视频 ≤30MB 走 `video_url`；txt/md/docx 注入文本；其余忽略)。
5. **模型未开通**：注册表标 active 只是"已适配"，账号没在方舟控制台开通会报 `ModelNotOpen`（控制台报错可见）。开通后无需改代码即可用。
6. **方舟视频 URL 有时效**：只有 `refreshVideoTask` 拉到的成功任务会被下载本地化；历史任务再次查询时也会补下载(终态任务不跳过本地化)。
7. **改依赖后要检查原生二进制**：`electron/` 与 `next/` 各自独立 `node_modules`，根目录只装 concurrently。
8. **本机 urllib 走代理会 502**：脚本调本项目接口请用 `curl`（`python3 urllib` 常被本机代理拦截返回 502）。
9. **视频画面质量**：Seedance 是画面语义模型——剧本/提示词要**动作驱动**(有起止的肢体动作 + 镜头说明)，避免"人物站着只动嘴"；对白写「人物台词：xxx」由模型输出语音，且台词要绑定动作。
10. **参考图必须进 `content[]`**：写顶层 `body.reference` 属于未知字段，方舟**静默忽略**——HTTP 200、任务照样成功，就是图完全没参与生成。零成本自检：带 `duration:999` 探测，返回 `in r2v` 才算识别，返回 `in t2v` 就是被当成纯文生视频了。
11. **AI 说"已保存"但库里没有**：工具按 `pickToolsByIntent` 关键词装载，用户只用承接性短指令(「加入」「存一下」「好的」)时容易漏判，此时模型会把调用裸写成 `<|FunctionCallBegin|>[...]` 文本。`chat/route.ts` 已有兜底解析+真执行，但**新增工具时要同步补触发词**。
12. **Seedance 2.0/2.5 不接受含真人人脸的参考图**(平台策略)：写实人像会被拦，需用预置虚拟人像或已授权素材；这也是人物库图选择时的硬约束。
