// 剧本物料(人物/场景/产品) → 生成时注入的「参考图 + 提示词块」
//
// 为什么要这块: 剧本/分镜里的 prompt 只写**剧情与画面**, 不含人物长相、场景陈设、产品外观;
// 这些在资料库里。生成视频时必须把两者合起来, 否则每段生成出来的形象都对不上。
//
// 短剧本(整集一次生成)与长剧本(按分镜分段生成)共用本模块。
import fs from "fs";
import path from "path";
import { dataDir, getDb, queryAll, queryOne } from "@/lib/server/db";

export type MaterialKind = "人物" | "场景" | "产品";

export interface ScriptMaterial {
  kind: MaterialKind;
  name: string;
  prompt: string;
  images: { name?: string; url: string }[];
}

/** 参考图条目(带来源信息, 便于提示词里的 @图像N 绑定) */
export interface RefImage {
  name?: string;
  url: string;
  kind: string;
  material: string;
}

function parseIds(raw: unknown): number[] {
  try {
    const a = JSON.parse(String(raw || "[]")) as unknown[];
    return a.filter((n): n is number => typeof n === "number");
  } catch { return []; }
}

/** 读剧本绑定的物料(人物/场景/产品), 每个物料带上它的全部图片(正面/侧面/服装…) */
export async function loadScriptMaterials(scriptId: number): Promise<ScriptMaterial[]> {
  if (!Number.isInteger(scriptId) || scriptId <= 0) return [];
  const db = await getDb();
  const script = queryOne(db, "SELECT character_ids, scene_ids, product_ids FROM scripts WHERE id=?", [scriptId]);
  if (!script) return [];

  const out: ScriptMaterial[] = [];
  const plan: [string, "characters" | "scenes" | "products", MaterialKind][] = [
    ["character_ids", "characters", "人物"],
    ["scene_ids", "scenes", "场景"],
    ["product_ids", "products", "产品"],
  ];
  for (const [col, table, kind] of plan) {
    const ids = parseIds(script[col]);
    if (!ids.length) continue;
    const rows = queryAll(
      db,
      `SELECT name, prompt, image_ids FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    // 收集图片 id → 一次性查 images 表(带名称, 如 正面照)
    const allImgIds = [...new Set(rows.flatMap((r) => parseIds(r.image_ids)))];
    const imgMap = new Map<number, { name: string; path: string }>();
    if (allImgIds.length) {
      const imgs = queryAll(
        db,
        `SELECT id, name, path FROM images WHERE id IN (${allImgIds.map(() => "?").join(",")})`,
        allImgIds,
      );
      for (const i of imgs) imgMap.set(Number(i.id), { name: String(i.name || ""), path: String(i.path || "") });
    }
    for (const r of rows) {
      out.push({
        kind,
        name: String(r.name || ""),
        prompt: String(r.prompt || ""),
        images: parseIds(r.image_ids)
          .map((n) => imgMap.get(n))
          .filter((x): x is { name: string; path: string } => !!x)
          .map((x) => ({ name: x.name, url: x.path })),
      });
    }
  }
  return out;
}

/**
 * 选参考图(均衡轮转): 先给每个物料保住第 1 张, 再按顺序补第 2/3 张, 直到模型上限。
 * 这样即使超限也不会有角色被整体丢掉。
 */
export function pickReferenceImages(mats: ScriptMaterial[], maxRef: number): RefImage[] {
  const groups = mats.map((m) => ({ kind: m.kind, material: m.name || "未命名", images: m.images }));
  const picked: RefImage[] = [];
  const maxDepth = groups.reduce((n, g) => Math.max(n, g.images.length), 0);
  for (let depth = 0; depth < maxDepth; depth++) {
    for (const g of groups) {
      if (maxRef > 0 && picked.length >= maxRef) break;
      const img = g.images[depth];
      if (img) picked.push({ name: img.name, url: img.url, kind: g.kind, material: g.material });
    }
    if (maxRef > 0 && picked.length >= maxRef) break;
  }
  return picked;
}

/**
 * 物料提示词块: 追加到生成提示词末尾, 让模型知道每个人物/场景/产品长什么样。
 * 有参考图时还会给出「@图像N」对应表(方舟按提示词里的 @图像N 绑定参考图)。
 */
export function buildMaterialsBlock(mats: ScriptMaterial[], refs: RefImage[] = []): string {
  if (!mats.length) return "";
  const lines: string[] = [];
  lines.push("", "【本片物料（画面必须与下列形象严格一致）】");
  for (const m of mats) {
    lines.push(`- ${m.kind}「${m.name}」：${m.prompt || "（无描述）"}`);
  }
  if (refs.length) {
    lines.push("", "【参考图对应】");
    const isHashLike = (s: string): boolean => /^[0-9a-f]{16,}$/i.test(s) || /^\d{10,}/.test(s);
    refs.forEach((r, i) => {
      const angle = r.name && !isHashLike(r.name) && r.name !== r.material ? `（${r.name}）` : "";
      lines.push(`@图像${i + 1} = ${r.kind}「${r.material}」${angle}`);
    });
    lines.push("人物外貌/服装、场景陈设光线、产品外观包装都要与对应 @图像N 保持一致，不要自行替换形象。");
  }
  return lines.join("\n");
}

/** 本地 /api/uploads/... → 存在的绝对路径(不存在返回 null) */
export function localImageFile(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  const f = path.join(dataDir(), "uploads", m[1], m[2]);
  return fs.existsSync(f) ? f : null;
}
