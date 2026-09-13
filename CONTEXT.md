# 项目上下文（Context）

> 给后续开发者/Agent 的项目背景与关键决策记录。最后更新：全栈化重构完成 dev 验证。

## 一、这是什么

**AI短剧工坊** —— 为「嘴硬家属」15 秒竖屏家庭短剧（带货类）批量生成视频的桌面工具。
核心工作流：**选人物/场景/产品/模板/节奏 → 自动组装 Seedance 提示词 → 一键生成 → 本地成品区管理播放**。

产品定位（客户约束）：
- 片尾不喊购买、不宣传治疗作用、不出现吃完立即见效画面
- 产品通过"放进背包/冰箱/行李箱"等自然动作出现，画面保留 2-3 秒清晰露出
- 固定人物设定（8 人）、固定关系，持续连载的一家人日常

## 二、技术栈与架构（当前）

- **Next.js 16（全栈 TS）+ antd 6 + React 19** —— 页面 + 全部后端 API（`app/api/**/route.ts`）
- **Electron 31（TS 壳）** —— 桌面壳（dev 加载 next dev；生产待改 standalone 服务器加载）
- **SQLite（better-sqlite3）** —— `data/drama.db`，WAL，首次启动建表+种子
- **豆包 Ark API** —— Seedance 视频生成 + Seed 2.0 文本对话

**全栈化**：原为「Next 纯前端 + FastAPI Python 后端」，已重构为 Next 一体化。
- 同一进程、同源 API（`/api/*`）、无 CORS、无独立后端端口、dev 一条命令
- `backend/`（Python）保留备查，不再参与运行时

## 三、目录速览

```
frontend/next/
├── app/page.tsx        # 主页面(四面板): 模型管理 / 剧本配置 / 提示词 / 成品区
├── app/api/            # 全部后端路由
│   ├── characters|products|scenes|story-templates|video-rhythms  (通用 CRUD 工厂)
│   ├── ai/             # configs CRUD + test(连接测试)
│   ├── generations/    # 生成任务: 列表/创建/preview/详情/删除
│   ├── settings/       # key-value 偏好
│   ├── system/reveal/  # 资源管理器定位文件
│   ├── logs/report/    # 前端崩溃上报
│   └── videos/[id]     # 本地视频流(支持 Range)
├── lib/server/         # 服务端逻辑
│   ├── db.ts           # SQLite 连接 + 建表 + 种子 + (惰性首次初始化)
│   ├── catalog.ts      # 字典档 CRUD 通用工厂
│   ├── ai.ts           # 模型配置 CRUD
│   ├── generations.ts  # 生成记录数据访问
│   ├── doubao.ts       # 豆包 Ark 客户端(fetch)
│   ├── prompt.ts       # ★提示词引擎(结构化→提示词)
│   ├── pipeline.ts     # 生成流水线(提交/轮询/下载/断点恢复)
│   ├── http.ts         # 统一 CRUD handler 工厂 + HttpError
│   └── logger.ts       # 轻量日志(控制台 + data/logs/app.log)
```

## 四、数据模型（9 张表）

- `settings` key-value 界面偏好
- `ai_config` 模型配置（kind: video/chat/image；保存 API Key 可空，回落环境变量）
- `characters` 人物（8 人种子）
- `products` 产品（5 个种子，fit_persons/appear_ways 为 JSON 数组）
- `scenes` 场景（8 个种子）
- `story_templates` 故事模板（2 个种子，beats 为分秒节拍 JSON）
- `video_rhythms` 节奏（1 个种子：情绪钩子→嘴硬回应→关心反转→情感收尾）
- `generations` 生成记录（status: draft/queued/running/succeeded/failed/downloaded；额外字段 JSON）
- 建表与种子 SQL 与历史 Python 版完全一致 → 旧库可无缝沿用

## 五、关键流程

**创建生成任务**（POST /api/generations）：
1. 结构化配置解析：character_ids/product_id/scene_id/template_id/rhythm_id → 取对应字典档记录
2. 提示词组装：`prompt_engine`（系列设定→人物外形→场景→产品出现方式→模板块→节奏→输出规范），用户可覆写（prompt_override）
3. 落库（status=draft）→ pipeline.start：提交豆包拿 task_id → status=queued → 10s 轮询 → 成功后下载到 `data/videos/<gid>.mp4` → status=downloaded
4. 断点恢复：服务重启后扫描 queued/running 残留任务重新挂轮询

**模型连接测试**（POST /api/ai/test）：只读枚举 `/models` 校验 key + 可选校验模型在列表中，**不产生生成费用**。

## 六、运行说明

```bash
cd frontend && npm run dev            # 全栈(3171), 一条命令
cd frontend/next && npm run dev       # 同上(脚本内置 set DRAMA_DATA_DIR=../../data)
```

- dev 数据目录：`frontend/next/../../data`（即项目根 `data/`）
- 打包版数据目录：exe 旁 `data/`（Electron 启动时设 `DRAMA_DATA_DIR`）
- API Key：根 `.env` 的 `DOUBAO_API_KEY`（后端代码读 `process.env`）；模型面板可单独填

## 七、踩坑记录（重要）

1. **Next webpack 不能打包 sql.js（.wasm）**：曾用 sql.js + `serverExternalPackages`，仍被 webpack 静态分析 `require.resolve` 子路径 → ModuleParseError；且 instrumentation 编译（edge 兼容）导致 `Can't resolve 'fs'`。**最终换 better-sqlite3**（原生模块走 `serverExternalPackages` 官方路径），并移除 instrumentation 改为「首次 getDb 时惰性建表/种子/恢复任务」。
2. **磁盘空间**：打包期 npm-cache/tmp/.next/缓存曾把 C 盘压到 2GB → next 编译卡死（症状: Compiling 卡住 + 页面 000）。清理后正常。**打包前先确认磁盘 ≥ 5GB**。
3. **Next 16 monorepo 探测**：主目录 `C:\Users\86150\package-lock.json` 存在时 Next 会把主目录当项目根 → 需 `next.config.ts` 显式 `outputFileTracingRoot: path.join(__dirname, "..")`。
4. **端口**：dev 前端 3171（历史 FastAPI 8031 已随全栈化退役）。
5. **antd 6 弃用 API**：`Space direction`→`orientation`；`List` 弃用→项目用纯 div 实现列表（Listy 是虚拟列表新 API，不适用小列表）。
6. **Electron 资源**：打包版若含原生模块（better-sqlite3）需 electron-builder 自动 rebuild（`asarUnpack` global）。

## 八、待办

- [ ] Electron 生产壳：TS 编译 + 启动 next standalone 服务器（`output: "standalone"` 已配）+ 等待就绪后 `loadURL(127.0.0.1:3171)`
- [ ] 打包脚本（scripts/build.js）全栈化：next build → standalone 收整 → electron-builder → 组装 release；去掉 PyInstaller
- [ ] 前端 README 中的 dev 脚本链路（frontend/electron package.json）对齐全栈
- [ ] 15 秒分段拼接 + 结尾字幕自动叠加（Seedance 单次 5/10 秒上限，节奏表已驱动分段结构）
- [ ] 数据目录收敛：`data/` 全部产物 gitignore（已配），注意 ai_config 保存的 API Key 不泄露

## 九、参考项目

- 架构/工程习惯参考：「微信公众号ocr采集器」（同机 C:\Users\86150\Desktop\微信公众号ocr采集器）—— 目录分层、脚本组织、日志思路
- 需求来源：《嘴硬家属_15秒家庭短剧带货Skill方案.docx》（根目录）