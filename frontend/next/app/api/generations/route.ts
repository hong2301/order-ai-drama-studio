// 生成路由: 提交生成 / 列表(移植自 backend/app/routers/generations.py)
import type { NextRequest } from "next/server";
import { jsonError, HttpError } from "@/lib/server/http";
import { RESOURCES } from "@/lib/server/catalog";
import * as aiRepo from "@/lib/server/ai";
import * as genRepo from "@/lib/server/generations";
import { buildStructuredPrompt, buildFreePrompt, StructuredConfig } from "@/lib/server/prompt";
import * as pipeline from "@/lib/server/pipeline";
import type { GenerationCreate } from "@/app/lib/types";
import type { Row } from "@/lib/server/catalog";
import type { Generation } from "@/app/lib/types";

/** 结构化配置 -> prompt 引擎入参; 缺 id 不阻塞(该项跳过), strict 时关键项缺失报错 */
async function resolveStructured(p: GenerationCreate, strict = true): Promise<StructuredConfig> {
  const chars: Row[] = [];
  const allChars = await RESOURCES.characters.repo.list();
  for (const cid of p.character_ids || []) {
    const c = allChars.find((x) => x.id === cid);
    if (c) chars.push(c);
  }
  if (strict && !chars.length) throw new HttpError(400, "请至少选择一位人物");

  let product: Row | null = null;
  if (p.product_id) {
    product = (await RESOURCES.products.repo.list()).find((x) => x.id === p.product_id) || null;
  }
  if (strict && !product) throw new HttpError(400, "请选择产品");

  const scene = p.scene_id
    ? (await RESOURCES.scenes.repo.list()).find((x) => x.id === p.scene_id)
    : null;
  const template = p.template_id ? await RESOURCES["story-templates"].repo.get(p.template_id) : null;
  const rhythm = p.rhythm_id ? await RESOURCES["video-rhythms"].repo.get(p.rhythm_id) : null;
  const appearWay = p.appear_way || ((product?.appear_ways as string[]) || [""])[0] || "";

  return {
    characters: chars as never,
    scene: scene as never,
    product: product as never,
    appear_way: appearWay,
    template: template as never,
    rhythm: rhythm as never,
    duration: p.duration,
    resolution: p.resolution,
    ratio: p.ratio,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || 50);
    return Response.json(await genRepo.listGenerations(limit));
  } catch (e) { return jsonError(500, (e as Error).message); }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const p = (await req.json()) as GenerationCreate;
    let prompt: string;
    let cfg: StructuredConfig;
    if (p.mode === "free") {
      if (!(p.prompt || "").trim()) throw new HttpError(400, "自由模式请填写完整提示词");
      prompt = buildFreePrompt(p.prompt || "");
      cfg = {};
    } else {
      cfg = await resolveStructured(p);
      const ov = (p.prompt_override || "").trim();
      prompt = ov ? ov : buildStructuredPrompt(cfg);
    }

    // 取当前启用启用的视频模型(默认第一个)
    const all = await aiRepo.listConfigs(true);
    const videoModels = all.filter((m) => m.kind === "video");
    const modelCfg = (videoModels.length ? videoModels : all)[0];
    if (!modelCfg) throw new HttpError(400, "未配置可用的 AI 模型，请先在模型管理中添加");

    const extra = {
      characters: (cfg.characters || []).map((c) => (c as unknown as Row).name),
      scene: (cfg.scene as unknown as Row | null)?.name || "",
      product: (cfg.product as unknown as Row | null)?.name || "",
      appear_way: cfg.appear_way || "",
      template: (cfg.template as unknown as Row | null)?.name || "",
      rhythm: (cfg.rhythm as unknown as Row | null)?.name || "",
    };
    const gid = await genRepo.createGeneration({
      mode: p.mode,
      title: p.title || (cfg.template as unknown as Row | null)?.name || "未命名",
      prompt,
      model_id: modelCfg.model_id,
      status: "draft",
      duration: p.duration,
      resolution: p.resolution,
      ratio: p.ratio,
      seed: p.seed,
      extra,
    });
    try {
      await pipeline.start(gid);
    } catch (e) {
      throw new HttpError(400, `启动生成失败: ${(e as Error).message}`);
    }
    return Response.json(await genRepo.getGeneration(gid));
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    return jsonError(500, (e as Error).message);
  }
}

export type { Generation };