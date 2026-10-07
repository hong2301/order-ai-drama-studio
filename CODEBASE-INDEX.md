# AI视频工坊 — 代码库索引 (CODEBASE INDEX)

> 结构查询/调用链/影响面的快速索引(对标 codebase-memory)。改代码前可先看这里, 再对照 AGENTS.md 的目录地图。
> 用户视角的完整操作链路见 **[OPERATION-FLOWS.md](OPERATION-FLOWS.md)**。
> 项目: Next16 全栈(页面+API) + Electron 壳 + sql.js SQLite, 端口 3171。

## 快速决策表

| 想做什么 | 路径 / 调用链 |
|---|---|
| 找某 API 实现 | `next/app/api/<name>/route.ts`(每个文件即一个接口) |
| 找后端核心逻辑 | `next/lib/server/`(db/doubao/chatSystem/library/scriptParse/video) |
| 找页面组件 | `next/app/components/*.tsx`(Chat/Script/Console/InfoCard/VideoLibrary/KeySettings/ImageGallery) |
| 模型探测/可用性 | 对话=`lib/server/video/modelsProbe.ts`(24h缓存); 视频=`probeVideo.ts`(duration=999 零成本探测) |
| 视频模型增改 | `lib/server/video/registry.ts` + (新商家)`providers/<name>.ts` |
| 数据库表/列 | `lib/server/db.ts` initSchema 内(幂等 CREATE/ALTER) |
| API Key 当前值 | `lib/server/db.ts getApiKey()`(DB settings.doubao_api_key 优先, env 兜底) |
| 对话消息存哪 | DB `conversations` + `messages` 表(已弃用 localStorage) |

## 模块 → 依赖图(页面层级)

```
app/page.tsx (client, head: logo + 版本号(读 /api/version) + APIKey)
├─ ChatModule        → /api/chat(工具调用) · /api/conversations* · /api/models·/select
├─ ScriptModule      → /api/scripts* (列表/上传/解析/批量删) → 联动三库/控制台
├─ ConsoleModule     → /api/video/models(探测) · /api/video/generate(占位+后台提交) · /api/video/tasks/[id](轮询)
├─ InfoCardModule ×3 → /api/{characters|scenes|products}*(增查改删+names/ids定位) · /api/images* · ImageGalleryModal(图库弹窗)
├─ VideoLibraryModal → /api/video/tasks*(列表/刷新/删)  ← 由 videos-changed 事件驱动刷新
└─ KeySettings       → /api/settings/key(读写 DB)
```

## 关键调用链(主线)

### ① 视频生成(控制台/AI 均可, 点击即占位)
```
前端 start() → POST /api/video/generate
  → createPlaceholderTask()        立即落库占位(local-xxx / queued) ← 秒回, 视频库马上有"生成中"
  → runGenerate() [后台]           一致性适配(adaptPrompt, 调AI) → createVideoTask() → doubao provider.submit() 提交方舟
  → 真实 cgt-xxx 任务落库 + 删占位行
前端 watchTask 轮询 /api/video/tasks/{id} → refreshVideoTask() → provider.get() 拉方舟 → 成功下载视频本地化(data/uploads/videos/)
```

### ② AI 对话(工具按需装载 + 技能索引化)
```
POST /api/chat
  system = SYSTEM_PROMPT(索引+纪律) [+ SCRIPT_SKILL 当 needScriptSkill(写剧本意图)]
  tools  = pickToolsByIntent()    按关键词装载 剧本组/库组/视频组(日常零工具)
  onToolCall 分发: add_script / save_last_script(轻量,取上一条回复) / transform_script / video_to_script(B方案:先初稿后入库) /
                  create_video(返回 task_id→前端轮询) / add_character·scene·product / query|update|delete_* / query_video_models / read_file
  附件: 图片/视频→data URL(≤10/30MB)+ 注入路径提示; txt/docx→文本注入
```

### ③ 剧本解析→三库(入库后后台异步)
```
add_script/解析 → execAddScript: INSERT scripts → **后台** parseScript(id) (不阻塞响应)
parseScript: 调AI提取 人物/场景/产品/分辨率/时长/比例/关键词 → upsertLibraryRecord(同名合并:身份并集·图片并集·提示词AI融合)
             → 更新 scripts.character_ids/scene_ids/product_ids + materials_fp
```

### ④ 点击剧本联动三库(按名称)
```
ScriptModule 点击 → library-link 事件 {charNames/sceneNames/prodNames, ...}
InfoCardModule onLink → GET /api/{库}?names=...(name_key 匹配) → 命中的记录 置顶+全量替换选中(不属于的取消)
三库 GET 现在走 listLibraryRecords(共享, 支持 keyword/ids/names)
```

## 跨模块事件总线(前端, CustomEvent)

| 事件 | 由谁发 | 谁听 | 触发刷新的含义 |
|---|---|---|---|
| `scripts-changed` | Chat(AI写库) / Script / InfoCard / Console | ScriptModule.refresh + InfoCard.load | 剧本/三库数据变了 |
| `library-link` | ScriptModule(选剧本) | InfoCardModule(联动选中) + ConsoleModule(同步参数) | 选中剧本→三库/控制台联动 |
| `videos-changed` | Console & Chat 的 watchTask(视频完成) / VideoLibrary 删除 | VideoLibraryModal.reload | 视频库数据变了 |

## 数据库表(video_tasks 之外都是 initSchema, PATH 约束)

| 表 | 结构要点 | 用途 |
|---|---|---|
| settings | key/value | 配置(doubao_api_key / chat_model / data_path) |
| scripts | name/file_path/content + character_ids·scene_ids·product_ids(resolution/duration/ratio/keywords/materials_fp) | 剧本+解析结果 |
| characters/scenes/products | name/identity(JSON)/prompt/image_ids(JSON)/content_key/name_key | 三库(去重键) |
| images | path/name/description | 图库(三库图片引用) |
| video_tasks | provider/model_key/script_name/prompt/status/video_url/error/resolution/ratio/duration | 视频任务(id=方舟 cgt-xxx 或 local-占位) |
| conversations/messages | conv_id/role/content/images(JSON) | 对话记录(数据库存储) |

## 影响面速查(改一处会波及哪)

| 改动点 | 影响 |
|---|---|
| `chatSystem.ts SYSTEM_PROMPT/SCRIPT_SKILL` | 全部 AI 对话行为(每天注入的上下文) |
| `db.ts initSchema` | 全库表结构(dev 与正式版各自 data/) |
| `video/registry.ts` 增删模型 | 控制台下拉 + AI(query_video_models) + 提交校验链 |
| `library.ts upsertLibraryRecord` | 三库任何写入门(UI/AI/解析/导入)的去重合并行为 |
| `chat/route.ts pickToolsByIntent` | 工具装载的触发词(加工具要同步加触发词) |
| `video/index.ts refreshVideoTask` | 任务状态推进/占位兜底/本地化下载 |

## Codebase-Memory 风格查询提示(如果有图工具)

- 找"谁调用 createVideoTask": `trace_path(function_name="createVideoTask", direction="inbound")` → generate/route(后台) + chat/route(create_video 工具)
- 找"消息保存链路": `trace_path(function_name="PUT /api/conversations/[id]")` → ChatModule 的 fetch 调用
- 死代码/冷门面: `search_graph(max_degree=0, exclude_entry_points=true)`(目前无检出工具的替代: AGENTS.md 已知坑/或 grep)