# AI短剧工坊《嘴硬家属》15秒家庭短剧

豆包 Seedance 文字生成视频工具：选人物/场景/产品/模板/节奏，自动组装提示词，一键生成竖屏短剧。

## 技术栈

**Next.js（全栈 TS）+ Electron（TS 壳）** —— 前后端一体化，无独立后端进程。

```
ai视频/
├── frontend/
│   ├── next/                    # ★ 全栈: Next 16 + React 19 + antd 6 (TypeScript)
│   │   ├── app/page.tsx         #   模型管理/剧本配置/提示词/成品区 四面板
│   │   ├── app/api/**/route.ts  #   全部后端 API(代替原 FastAPI)
│   │   └── lib/server/          #   DB(sqlite)/豆包客户端/提示词引擎/生成流水线
│   └── electron/                # Electron 31 壳(TS 编译, 加载 next 服务器)
├── scripts/build.js             # 一键打包
├── backend/                     # (历史) 原 FastAPI 后端, 全栈化后保留备查
├── data/                        # drama.db + videos/ + logs/ (gitignore)
└── release/                     # 打包产物 (gitignore)
```

## 运行

```bash
# 一条命令起全栈(next dev 自带 API) —— 不需要双终端, 没有独立后端端口
cd frontend
npm run dev
# 或:
# cd frontend/next && npm run dev      (默认 3171 端口)
```

- 数据库：`better-sqlite3`（`data/drama.db`，首次启动自动建表+种子：8人物/5产品/8场景/2模板/1节奏/3模型）
- API：同源 `/api/*`（dev: `http://127.0.0.1:3171/api/...`）
- 视频成品：`data/videos/<id>.mp4`，通过 `/api/videos/<id>.mp4` 访问（支持 Range 拖动播放）

## Data 环境变量（根 `.env`，已 gitignore）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DOUBAO_API_KEY` | 空 | 火山方舟 API Key（模型面板"测试连接"只读校验，不产生费用） |
| `DRAMA_DATA_DIR` | 项目 data/ | 数据目录（dev 脚本已显式设 `../../data`） |
| `DRAMA_LOG_LEVEL` | INFO | 日志级别 |

## API 总览（全在 Next 服务端）

- `/api/health` — 健康检查
- `/api/characters|products|scenes|story-templates|video-rhythms` — 字典档 CRUD（通用工厂）
- `/api/ai/configs[/:id]` + `/api/ai/test` — 模型管理 + 连接测试
- `/api/generations[/:id]` + `/preview` — 生成任务（自动组装提示词→提交豆包→轮询→下载）
- `/api/settings/:key` — 界面偏好
- `/api/system/reveal` — 资源管理器定位文件
- `/api/logs/report` — 前端崩溃上报
- `/api/videos/:id.mp4` — 本地视频流（Range）

## 关键设计

- **提示词引擎**（`lib/server/prompt.ts`）：结构化配置→完整 Seedance 提示词（系列设定/人物外形一致/产品自然出现/分秒节拍/输出规范）
- **生成流水线**（`lib/server/pipeline.ts`）：提交→10s 轮询→下载到 `data/videos/`，服务重启自动恢复未完成任务
- **数据库**：单文件 SQLite，WAL；SQL 与历史 Python 版完全一致，旧库可直接沿用

## 历史与重构说明

- 原架构为「Next 纯前端 + FastAPI 后端」；已全栈化（FastAPI 退役，`backend/` 保留备查）
- 全栈化后：`dev` 一条命令、同源 API、无需 CORS、无独立后端进程
- 状态：**dev 全链路已验证通过**；Electron 生产壳（standalone 服务器加载）与打包脚本收尾中

## 待办

- [ ] Electron 生产模式改为拉起 next standalone 服务器（TS 壳）
- [ ] 打包脚本全栈化（去掉 PyInstaller 链路）
- [ ] 15 秒分段拼接 + 结尾字幕自动叠加（Seedance 单次上限 5/10 秒）