// 视频生成: POST /api/video/generate
// body: {modelKey, prompt?, scriptId?, imageUrl?, resolution?, ratio?, duration?}
// 流程: 立即创建占位任务(视频库立即可见"生成中") → 后台异步做 一致性检查/剧情适配(调AI) → 提交方舟 →
//       成功用真实任务更新占位(id 替换), 失败标记占位 failed
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, persist, queryAll, queryOne, dataDir } from "@/lib/server/db";
import { adaptPrompt, materialsFp } from "@/lib/server/video/adapt";
import { createVideoTask, createPlaceholderTask, ensureVideoTables, TABLE, friendlyVideoError, readImageSize } from "@/lib/server/video";
import { getModelDef } from "@/lib/server/video/registry";
import type { VideoTask } from "@/lib/server/video/types";

export const dynamic = "force-dynamic";

function parseIds(raw?: string): number[] {
  try {
    const a = JSON.parse(String(raw || "[]")) as unknown[];
    return a.filter((n): n is number => typeof n === "number");
  } catch { return []; }
}

function materialsOf(db: Awaited<ReturnType<typeof getDb>>, table: "characters" | "scenes" | "products", ids: number[]): { name: string; prompt: string; images: { name: string; url: string }[] }[] {
  if (!ids.length) return [];
  const rows = queryAll(db, `SELECT name, prompt, image_ids FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  // 收集全部图片 id → 一次性查 images 表(带名称, 如 正面照)
  const allImgIds = [...new Set(rows.flatMap((r) => parseIds(String(r.image_ids || ""))))];
  const imgMap = new Map<number, { name: string; path: string }>();
  if (allImgIds.length) {
    const imgs = queryAll(db, `SELECT id, name, path FROM images WHERE id IN (${allImgIds.map(() => "?").join(",")})`, allImgIds);
    for (const i of imgs) imgMap.set(Number(i.id), { name: String(i.name || ""), path: String(i.path || "") });
  }
  return rows.map((r) => ({
    name: String(r.name || ""),
    prompt: String(r.prompt || ""),
    images: parseIds(String(r.image_ids || "")).map((n) => imgMap.get(n)).filter((x): x is { name: string; path: string } => !!x).map((x) => ({ name: x.name, url: x.path })),
  }));
}

interface GenBody {
  modelKey?: string; prompt?: string; scriptId?: number | null;
  imageUrl?: string | null; resolution?: string; ratio?: string; duration?: number;
  scriptName?: string;
  /** 剧本形态(short/long): 由剧本继承; 也允许前端显式传 */
  kind?: string;
}

/** 生成硬性约束(补在提示词末尾, 不改剧本内容; 让视频模型严格贴剧本人设场景产品) */
const GENERATION_CONSTRAINTS = [
  "",
  "【生成硬性要求】",
  "1. 严格遵循以上剧本的剧情、分镜顺序、对白与情绪, 不得自行加戏或偏离。",
  "2. 人物/场景/产品必须按剧本设定画面呈现(外貌/服装/光线/包装), 不得替换、缺失或变样。",
  "3. 镜头角度正常自然(常规平视机位), 动作有起止、人物不要长期静止站桩。",
  "4. 对白用「人物台词：xxx」, 配合动作; 画面不出现字幕卡/文字。",
  "5. 画面比例与时长严格遵守(如9:16·15秒), 情绪克制、生活化、轻冲突温暖反转。",
  "6. 人物服装/造型必须与当前场景匹配(居家穿家居服、外出穿外套/鞋、办公穿正装、季节与光线相应); 场景变化时人物服装要同步调整, 同一人物在同一集内保持同一套造型。",
].join("\n");

/** 把占位(或任意任务)标记为失败 —— 生成链路兜底用 */
async function markPlaceholderFailed(id: string, msg: string): Promise<void> {
  try {
    const db = await getDb();
    db.run(`UPDATE ${TABLE} SET status=?, error=?, video_url='', updated_at=? WHERE id=?`,
      ["failed", friendlyVideoError(msg).slice(0, 200), new Date().toISOString(), id]);
    await persist();
    console.log(`[evt] emit failed ${id}: ${friendlyVideoError(msg).slice(0, 40)}`);
  } catch { /* ignore */ }
}

/** 后台: 一致性适配(有绑定剧本时) → 提交方舟 → 用真实任务替换占位; 失败将占位标记 failed */
async function runGenerate(b: GenBody, placeholderId: string): Promise<void> {
  const t0 = Date.now();
  const step = (s: string): void => console.log(`[generate] ${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
  // 参考图: 物料(人物/场景/产品)的**全部**图片 —— 声明在 try 外: catch 里要用它把方舟返回的 content[N] 换回物料名
  let refImgs: { name?: string; url: string; kind?: string; material?: string }[] = [];
  try {
    step("开始");
    await ensureVideoTables();
    let prompt = String(b.prompt || "");
    let scriptName = b.scriptName || "";

    // 一致性检查 + 剧情适配(仅当绑定了剧本时)
    const scriptId = Number(b.scriptId);
    if (Number.isInteger(scriptId) && scriptId > 0) {
      const db = await getDb();
      const row = queryOne(db, "SELECT * FROM scripts WHERE id=?", [scriptId]);
      if (row) {
        const chars = materialsOf(db, "characters", parseIds(String(row.character_ids || "")));
        const scenes = materialsOf(db, "scenes", parseIds(String(row.scene_ids || "")));
        const prods = materialsOf(db, "products", parseIds(String(row.product_ids || "")));
        const config = [b.resolution, b.ratio, b.duration ? `${b.duration}秒` : ""].filter(Boolean).join(" · ");
        // 一致性适配(仅三库物料变化时; 适配器会参考 人物/场景/产品 的图片)
        // 规则: 剧本本身可用, 直接作为提示词; 只有在 人物/场景/产品 被调整后才做一次一致性加工,
        //       加工成功即把 materials_fp 对齐标记, 之后物料未变不再重复加工
        const currentFp = materialsFp(chars, scenes, prods);
        if (currentFp !== String(row.materials_fp || "")) {
          db.run(`UPDATE ${TABLE} SET stage=? WHERE id=?`, ["adapting", placeholderId]);
          const adapted = await adaptPrompt({ content: String(row.content || ""), characters: chars, scenes: scenes, products: prods, config });
          if (adapted && adapted.prompt) {
            prompt = adapted.prompt;
            // 一致性加工成功 → 对齐 fp 标记, 避免物料未变时反复加工
            try {
              db.run(`UPDATE scripts SET materials_fp=?, updated_at=? WHERE id=?`,
                [currentFp, new Date().toISOString(), scriptId]);
              await persist();
              step("一致性加工完成(fp 已对齐)");
            } catch { /* 标记失败不影响本次 */ }
          } else {
            step("一致性加工失败/超时, 使用原提示词");
          }
          db.run(`UPDATE ${TABLE} SET stage=? WHERE id=?`, ["submitting", placeholderId]);
        } else {
          // 物料未变: 剧本原样使用, 不做任何 AI 加工
          db.run(`UPDATE ${TABLE} SET stage=? WHERE id=?`, ["submitting", placeholderId]);
        }
        scriptName = String(row.name || "");
        step("剧本物料查询完成");
        // 参考图: 物料(人物/场景/产品)下的**全部**图片都要用(正面/侧面/服装/包装等多角度)
        // 超出模型上限时用「均衡轮转」截断: 先保证每个物料至少 1 张, 再按顺序补第 2/3 张
        const groups = [
          ...chars.map((m) => ({ kind: "人物", material: m.name || "未命名", images: m.images || [] })),
          ...scenes.map((m) => ({ kind: "场景", material: m.name || "未命名", images: m.images || [] })),
          ...prods.map((m) => ({ kind: "产品", material: m.name || "未命名", images: m.images || [] })),
        ];
        const totalImgs = groups.reduce((n, g) => n + g.images.length, 0);
        const maxRef = getModelDef(String(b.modelKey || ""))?.presets?.maxReferenceImages || 0;
        const picked: typeof refImgs = [];
        const maxDepth = groups.reduce((n, g) => Math.max(n, g.images.length), 0);
        for (let depth = 0; depth < maxDepth; depth++) {
          for (const g of groups) {
            if (maxRef > 0 && picked.length >= maxRef) break;
            const img = g.images[depth];
            if (img) picked.push({ ...img, kind: g.kind, material: g.material });
          }
          if (maxRef > 0 && picked.length >= maxRef) break;
        }
        refImgs = picked;
        if (totalImgs > refImgs.length) {
          step(`参考图共 ${totalImgs} 张, 超出上限 ${maxRef || "?"} → 均衡取 ${refImgs.length} 张(每个物料优先保住首图)`);
        }
        // 单图/尺寸校验(官方: 宽高均 300~6000px、宽高比 0.4~2.5、单张 <30MB)
        for (const r of refImgs) {
          if (!r.url.startsWith("/api/uploads/")) continue;
          const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(r.url);
          if (!m) continue;
          const file = path.join(dataDir(), "uploads", m[1], m[2]);
          if (!fs.existsSync(file)) continue;
          const label = `${r.kind || "参考"}图「${r.name || "未命名"}」`;
          const mb = fs.statSync(file).size / 1024 / 1024;
          if (mb >= 30) throw new Error(`${label} 体积 ${mb.toFixed(1)}MB 超过方舟单图 30MB 上限, 请压缩后重新上传`);
          const size = readImageSize(file);
          if (!size) continue;
          const { w, h } = size;
          if (w < 300 || h < 300 || w > 6000 || h > 6000) {
            throw new Error(`${label} 尺寸 ${w}×${h}px 超出方舟要求(宽高均需在 300~6000px)。请到人物/场景/产品库更换图片`);
          }
          const ar = w / h;
          if (ar < 0.4 || ar > 2.5) {
            throw new Error(`${label} 宽高比 ${ar.toFixed(2)} 超出方舟要求(0.4~2.5), 请更换更常规的图片`);
          }
        }
        if (refImgs.length) step(`参考图 ${refImgs.length} 张(全模态参考锚定人物/场景/产品)`);
      }
    }

    // 参考图编号说明: 方舟按提示词里的「@图像N」把参考图绑到具体元素, 编号 = content 中参考图的先后顺序
    // 图片名(如 正面照/侧面/冬装)有意义时带上, 便于模型区分同一对象的多张参考图; hash 名不展示
    const isHashLike = (s: string): boolean => /^[0-9a-f]{16,}$/i.test(s) || /^\d{10,}/.test(s);
    const refHint = refImgs.length
      ? `\n\n【参考图对应(必须严格一致)】\n${refImgs.map((r, i) => {
          const angle = r.name && !isHashLike(r.name) && r.name !== r.material ? `（${r.name}）` : "";
          return `@图像${i + 1} = ${r.kind || "参考"}「${r.material || "未命名"}」${angle}`;
        }).join("\n")}\n画面中对应的人物(脸型/发型/服装造型)、场景(光线/陈设)、产品(外观/包装/文字)必须与 @图像N 保持一致; 同一对象的多张参考图(正面/侧面/不同服装等)属于同一形象, 描述这些元素时按 @图像N 书写, 严禁替换成其他形象。`
      : "";
    step(`提交 createVideoTask(参考图 ${refImgs.length} 张)`);
    const task = await createVideoTask({
      modelKey: String(b.modelKey || ""),
      // 末尾附 生成硬性约束(严格遵守剧本/人物场景产品/角度正常等)
      prompt: `${prompt}${refHint}\n${GENERATION_CONSTRAINTS}`.trim(),
      imageUrl: b.imageUrl || null,
      referenceImages: refImgs,
      resolution: b.resolution || undefined,
      ratio: b.ratio || undefined,
      duration: b.duration && b.duration > 0 ? b.duration : undefined,
      scriptName,
      kind: b.kind,
    });
    step("提交完成, 删除占位");
    const db = await getDb();
    db.run(`DELETE FROM ${TABLE} WHERE id=?`, [placeholderId]);
    await persist();
  } catch (e) {
    // 失败: 占位标记 failed(视频库占位消失/显示错误), 不中断
    // 方舟用 content[N] 指代第 N 个输入(N 从 1 起, content[0] 是文本) → 换成物料名, 让用户知道是哪张图出的问题
    const msg = (e as Error).message.replace(/content\[(\d+)\]/g, (raw, d) => {
      const r = refImgs[Number(d) - 1];
      return r ? `${r.kind || "参考"}图「${r.name || "未命名"}」` : raw;
    });
    await markPlaceholderFailed(placeholderId, msg);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let b: GenBody = {};
  try { b = (await req.json()) as GenBody; } catch { /* ignore */ }
  const modelKey = String(b.modelKey || "");
  if (!modelKey) return Response.json({ ok: false, detail: "缺少 modelKey" }, { status: 400 });
  try {
    await ensureVideoTables();
    // 绑定剧本 → 预取剧本名 + 形态(占位卡片显示/视频库隔离用; 毫秒级)
    let scriptName = b.scriptName || "";
    let kind = String(b.kind || "").trim();
    const scriptId = Number(b.scriptId);
    if (Number.isInteger(scriptId) && scriptId > 0) {
      const row = queryOne(await getDb(), "SELECT name, kind FROM scripts WHERE id=?", [scriptId]);
      if (row) {
        scriptName = String(row.name || "");
        kind = String(row.kind || "short");   // 视频跟随剧本形态(短剧本/长剧本各一个视频库)
      }
    }
    if (!kind) kind = "short";
    // 立即建占位 → 返回(视频库马上出现"生成中"); 适配/提交放后台(带 180s 兜底超时)
    const placeholder = await createPlaceholderTask({
      modelKey, prompt: String(b.prompt || ""),
      resolution: b.resolution, ratio: b.ratio,
      duration: b.duration && b.duration > 0 ? b.duration : undefined,
      scriptName,
      kind,
    });
    void (async () => {
      const guard = setTimeout(() => { void markPlaceholderFailed(placeholder.id, "生成提交超时(300s), 请重试"); }, 300000);
      try { await runGenerate({ ...b, scriptName, kind }, placeholder.id); } finally { clearTimeout(guard); }
    })();
    return Response.json({ ok: true, task: placeholder });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message }, { status: 400 });
  }
}

// 供类型引用(避免未使用告警)
export type { VideoTask };