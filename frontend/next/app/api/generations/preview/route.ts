// 提示词实时预览(不落库不生成): 结构化配置 -> prompt 文本
import type { NextRequest } from "next/server";
import { jsonError, HttpError } from "@/lib/server/http";
import { RESOURCES } from "@/lib/server/catalog";
import { buildStructuredPrompt, buildFreePrompt, StructuredConfig } from "@/lib/server/prompt";
import type { GenerationCreate } from "@/app/lib/types";
import type { Row } from "@/lib/server/catalog";

export const dynamic = "force-dynamic";

async function resolveStructured(p: GenerationCreate, strict = false): Promise<StructuredConfig> {
  const chars: Row[] = [];
  const allChars = await RESOURCES.characters.repo.list();
  for (const cid of p.character_ids || []) {
    const c = allChars.find((x) => x.id === cid);
    if (c) chars.push(c);
  }
  const product = p.product_id
    ? (await RESOURCES.products.repo.list()).find((x) => x.id === p.product_id) || null
    : null;
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

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const p = (await req.json()) as GenerationCreate;
    if (p.mode === "free") {
      return Response.json({ prompt: buildFreePrompt(p.prompt || "") });
    }
    const cfg = await resolveStructured(p, false);
    return Response.json({ prompt: buildStructuredPrompt(cfg) });
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    return jsonError(500, (e as Error).message);
  }
}