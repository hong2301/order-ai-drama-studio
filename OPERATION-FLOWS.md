# 操作链路总览（OPERATION FLOWS）

> 本文记录**用户视角的操作链路**及其对应的代码实现，供开发、交接、排障对照。
> 结构索引见 `CODEBASE-INDEX.md`，开发约定/已知坑见 `AGENTS.md`。

## 总览

| # | 链路 | 用户入口 | 落点 | 主实现 |
|---|---|---|---|---|
| 1 | 视频生成 | 控制台 / AI 对话 | 视频库 | `app/api/video/*` + `lib/server/video/*` |
| 2 | AI 对话工具调用 | AI 对话 | 剧本库 / 资料库 / 视频库 | `app/api/chat/route.ts` |
| 3 | 视频提取剧本 | AI 对话（带视频附件） | 剧本库（先初稿，确认后入库） | `execVideoToScript` |
| 4 | 三库同名合并融合 | 三库新增/编辑、剧本解析 | 人物 / 场景 / 产品库 | `lib/server/library.ts` |
| 5 | 人物参考图手绘化 | 人物库图片（离线处理） | 视频生成参考图 | 本地图像处理，无代码依赖 |

---

## 1. 视频生成链路

### 用户操作
1. 剧本库点选一个剧本 → 联动三库选中 + 控制台带入参数/提示词
2. 控制台选 模型 / 分辨率 / 画面比例 / 时长
3. 点「开始生成」→ 视频库**立即**出现"生成中"占位卡片
4. 成片自动进视频库（点击大播放器、右键删除），视频**本地落盘**持久保存

### 内部链路
```
POST /api/video/generate                    next/app/api/video/generate/route.ts
├─ createPlaceholderTask()                  立即落库 local-xxx (queued) → 接口秒回
└─ runGenerate()  [void 后台]
   ├─ materialsOf() ×3                      按 script 的 character_ids / scene_ids / product_ids 取物料
   ├─ materialsFp() 变化才 adaptPrompt()     AI 一致性适配（用 aux_model）
   ├─ 参考图收集                             每物料 **全部** 图片 → 超上限「均衡轮转」
   ├─ 参考图校验                             宽高 300~6000px / 宽高比 0.4~2.5 / 单图 <30MB
   ├─ 提示词注入「@图像N 对应表」             人工可读的图-物料绑定关系
   ├─ createVideoTask() → provider.submit()  建任务 + 提交方舟
   └─ 删除占位（真实 cgt-xxx 任务落库）

轮询 GET /api/video/tasks/[id]              lib/server/video/index.ts refreshVideoTask()
├─ provider.get()                           拉方舟最新状态
├─ succeeded → downloadVideo()              落盘 data/uploads/videos/<id>.mp4（方舟 URL 有时效）
└─ 占位兜底                                  local- 前缀 300s 未被替换 → failed
```

### 关键约束（踩过的坑）
- **参考图必须放进 `content[]` 且带 `role:"reference_image"`**（配合 `omni_reference_task_type:"reference"`）。
  旧实现写在顶层 `body.reference` —— 方舟**静默忽略**，任务照样 200 成功，图片却完全没参与生成。
  自检方法：带 `duration:999` 探测，返回 `in r2v` 才算识别，`in t2v` 就是被当成纯文生视频了。
- 参考图能力：**Seedance 2.0 系列 ≤9 张 / 2.5 ≤30 张；1.0 系列不支持**；与首帧图**互斥**。
- **Seedance 2.0/2.5 不接受含真人人脸的参考图** → 人物图需转为非写实风格（见链路 5）。
- 参考图张数 = 选中物料的图片总和；**超上限用「均衡轮转」截断**：先给每个物料保住第 1 张，再按顺序补第 2/3 张，
  保证不会有角色被整体丢掉。
- 提交超时**按请求体体积动态放宽**（基准 30s + 每 MB 3s，上限 180s）—— 多图参考时请求体可达数十 MB。
- 占位任务被真实任务替换时 id 会变，前端靠 `relistAndFollow()`（404 → 拉列表续盯）兜底。

---

## 2. AI 对话工具调用链路

### 用户操作
在 AI 对话里说「写一集剧本」「加入剧本库」「生成视频」「把人物存进人物库」等 →
AI 调用对应工具 → 结果落库 / 发起生成。

### 内部链路
```
POST /api/chat                              next/app/api/chat/route.ts
├─ 附件分流                                 图片→dataURL(≤10MB) / 视频→video_url(≤30MB) / txt·docx→注入文本
├─ system = SYSTEM_PROMPT [+ SCRIPT_SKILL]  写剧本意图时追加《剧本创作规范》
├─ pickToolsByIntent(msg, hasTextAttach, hasVideo)   ★工具按需装载
├─ chat() → onToolCall(handleToolCall)      工具循环（≤6 轮）
│   ├─ add_script / save_last_script / transform_script   → 写剧本库（后台异步解析）
│   ├─ add_character / add_scene / add_product            → 写资料库（同名合并，见链路 4）
│   ├─ query/update/delete_*                              → 查改删
│   ├─ video_to_script                                    → 见链路 3
│   ├─ create_video                                       → 直接发起视频生成
│   └─ read_file                                          → 读 txt/docx 附件
└─ 返回 { reply, scriptsChanged, videoTaskIds }
```

### 关键约束（踩过的坑）
- **工具按意图装载**是性能设计（日常对话零工具），但**漏判的代价很大**：模型手里没有工具定义时，
  会按训练格式把调用**裸写成文本**（形如 `<#_tragencode#><|FunctionCallBegin|>[{"name":"add_script",...}]<|FunctionCallEnd|>`），
  表现为「**AI 说已保存，剧本库却是空的**」。
  已修的三层：① 触发词补齐（承接性短指令「加入/保存/存一下/入库/重试」+ 极短肯定回应「好的/可以/是的/要」）；
  ② 回复里出现裸调用 → **解析出来真执行**（白名单只含写库类工具，**排除 create_video 以免误触发扣费**）；
  ③ 残留 token 一律清洗，不展示给用户。
- 解析用**括号配对扫描**而非非贪婪正则 —— 参数里含 `[` `]`（剧本正文很常见）会提前截断。
- **新增工具时必须同步补 `pickToolsByIntent` 的触发词**，否则会重现上面的问题。
- `save_last_script` 取的是**上一条 assistant 回复**；`add_script` 内容来自附件时会自动补 `file_path`。

---

## 3. 视频提取剧本链路

### 用户操作
1. 在 AI 对话里**上传一个视频**，可以顺带提要求（**时长** / 比例 / 分辨率）
2. AI 观看视频 → 输出【画面提示词】+ 一集完整剧本（初稿）
3. AI 主动问「**是否把这个剧本加入剧本库**」
4. 用户确认 → 走 `add_script` 入库

### 内部链路
```
上传视频 → localVideoToDataUrl()            ≤30MB, mp4/webm/mov/m4v
pickToolsByIntent(..., hasVideo=true)       带视频附件即装载 VIDEO_TO_SCRIPT_TOOL
→ video_to_script(video_url, name?, duration?, ratio?, resolution?)
  → execVideoToScript()                     next/app/api/chat/route.ts
     ├─ 组装 instruction：输出规范 + 用户对成片的要求（时长写进分镜切分约束）
     ├─ 视频已在**本轮上下文**时不重复传（省体积/降成本）
     └─ chat(...) 观看视频 → draft（**只出初稿，不落库**）
→ 模型把 draft 原文展示给用户 + 问是否入库
→ 用户确认 → add_script 入库（触发后台解析）
```

### 关键约束
- **对话模型必须支持视频输入**（`modalities.input_modalities` 含 `video`）。
  实测：`doubao-seed-2-1-pro-260915` / `seed-2-0-mini` / `seed-1-6` 系列均支持。
- 视频附件上限 **30MB**（超出直接忽略，不报错）。
- 时长约束会同时写进「视频配置表」和「分镜切分」（各段秒数之和 = 指定时长）。
- 该工具**只出初稿**，落库必须由用户确认后走 `add_script`（B 方案）。

---

## 4. 三库同名合并融合链路

> 人物 / 场景 / 产品三库共用一套逻辑（`lib/server/library.ts`）。

### 用户操作
给人物/场景/产品录入 名称 + 提示词 + 图片。**同名（容错空格/标点/全半角/大小写）不会产生第二条记录**，
而是自动合并：图片并集、身份标签并集、**提示词交给 AI 判断后融合**。

### 设计意图（重要）
- **按名称合并，不按 id 去重**。理由：用户的心智是"针对这个名字"，没有抽象对象概念；
  若按 id，同名会堆出一堆难辨认的记录。
- 碰到同名**不是简单去重/覆盖**，而是**合并 + 融合**。

### 内部链路
```
upsertLibraryRecord(table, {name, identity, prompt, image_ids})
├─ withNameLock(`${table}|${normName(name)}`)      ★同名写入串行化（见下）
├─ nkey = normName(name)                            全角→半角 / 去空格标点 / 小写
├─ 按 name_key 命中同名记录？
│   ├─ 是 → 合并：
│   │    ├─ identity : uniqTags(旧 + 新)                      并集去重
│   │    ├─ image_ids: [...new Set(旧 + 新)]                  并集去重，保序
│   │    └─ prompt    : mergePrompts(旧, 新)                  ★AI 判断后融合
│   └─ 否 → 新建
```

`mergePrompts` 的判定顺序（**确定性优先，尽量减少 AI 参与**）：
1. 一方为空 → 取另一方
2. 完全相同 / 一方包含另一方 → 直接取，**不调 AI**
3. 长短相差 2 倍以上 → 取更全的那份，**不调 AI**
4. 以上都不是才调 AI 融合，指令硬约束：
   - **只能使用 A/B 中已出现的信息，不得新增**
   - 篇幅 ≤ 较长原文的 1.2 倍
   - 输出为空 / 过短 / 爆长 → **判为不可靠，降级取更全的原文**（不信任模型自由发挥）
5. 超时（60s）/ 失败 → 降级取更全的原文

### 关键约束（踩过的坑）
- **并发竞态**：合并要先查库、再调 AI 融合（耗时数秒~数十秒）。这段 await 窗口内若另一个同名请求到达，
  它会看到"记录不存在"从而**新建一条重复记录** —— 这是"用 AI 判断合并"的固有代价。
  已用 **`withNameLock`（`globalThis` 上挂 Map，key = 表+名称）** 串行化同名写入；不同名互不阻塞。
  实测：并发 4 个同名请求 → 库里只落 **1 条**。
- **图片是并集累积**（同一对象的多角度参考图都要留），配合链路 1 的"参考图全用上"会推高参考图张数与请求体体积；
  生成时按模型上限**均衡取用**兜底。
- **辅助模型**：融合/适配/解析用 `settings.aux_model`（默认轻量模型）。
  对话模型若是**推理模型**（如 `doubao-seed-2-1-pro`，单次融合要 53.6s / 2249 reasoning tokens），
  会让这些任务**超过各自超时、静默降级 → 功能形同失效**。`aux_model` 为空时沿用对话模型（旧行为）。

---

## 5. 人物参考图「手绘化」链路（绕过真人脸限制）

### 背景
Seedance 2.0/2.5 **不接受含真人人脸的参考图**（`InputImageSensitiveContentDetected.PrivacyInformation`）。
写实人像（哪怕手绘/AI 生成）会被拦 → 导致**整个生成请求被 400 拒绝**。
而参考图只提供"形象锚定"，**不决定成片画风**（画风由提示词决定，默认输出写实）。

### 操作流程（离线，无代码依赖）
1. 把人物库里的写实图**转成非写实风格**（本地 OpenCV 滤镜：保边平滑 + 色阶量化 + 描边，像素级变换、长相不变）
2. 原图**另存备份**（`*.real.png`），手绘版就地替换（**DB 的 `path` 不动**）
3. 生成时正常作为参考图 → 通过人脸检测 → 成片仍是写实风格

### 验证结论（实测）
| 参考图 | 方舟判定 |
|---|---|
| 原写实照片 | ❌ 含真人 |
| 手绘/卡通化版本 | ✅ **通过** |

- 长相、发型、服装、背景在成片中**与参考图一致** → 说明参考图确实生效
- ⚠️ 合规提醒：这是"用非写实图过检测、产出写实脸"的路径。若角色有真人原型，存在肖像权风险；
  纯虚构角色无此问题。

### 产品参考图
产品图通常是**实拍**（无真人脸）→ **不需要**做这个转换，可直接用作参考图。
若产品图含真人模特/真人脸，同样会被拦。
