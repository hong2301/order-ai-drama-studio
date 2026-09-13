# -*- coding: utf-8 -*-
"""生成路由: 提交生成 / 列表 / 详情 / 删除"""
import os
from fastapi import APIRouter, HTTPException

from ..database import videos_dir
from ..models import GenerationCreate
from ..repositories import ai_repo, catalog_repo, generations_repo
from ..services import prompt_engine, video_pipeline

router = APIRouter(prefix="/api/generations", tags=["generations"])


def _resolve_structured(p: GenerationCreate, strict: bool = True) -> dict:
    """结构化配置 -> prompt 引擎入参; 缺 id 不阻塞(该项跳过), strict 时关键项缺失报错"""
    chars = []
    for cid in p.character_ids:
        c = next((x for x in catalog_repo.list_characters() if x["id"] == cid), None)
        if c:
            chars.append(c)
    if strict and not chars:
        raise HTTPException(400, "请至少选择一位人物")
    product = next((x for x in catalog_repo.list_products() if x["id"] == p.product_id), None) if p.product_id else None
    if strict and not product:
        raise HTTPException(400, "请选择产品")
    scene = next((x for x in catalog_repo.list_scenes() if x["id"] == p.scene_id), None) if p.scene_id else None
    template = catalog_repo.get_template(p.template_id) if p.template_id else None
    rhythm = catalog_repo.get_rhythm(p.rhythm_id) if p.rhythm_id else None
    appear_way = p.appear_way or (product.get("appear_ways") or [""])[0]
    cfg = {
        "characters": chars, "scene": scene, "product": product,
        "appear_way": appear_way, "template": template, "rhythm": rhythm,
        "duration": p.duration, "resolution": p.resolution, "ratio": p.ratio,
    }
    return cfg


@router.post("/preview")
def preview_generation(p: GenerationCreate):
    """提示词实时预览(不落库不生成): 结构化配置 -> prompt 文本"""
    if p.mode == "free":
        return {"prompt": prompt_engine.build_free_prompt(p.prompt)}
    cfg = _resolve_structured(p, strict=False)
    return {"prompt": prompt_engine.build_structured_prompt(cfg)}


@router.post("")
def create_generation(p: GenerationCreate):
    """提交生成: 完成提示词组装 + 落库 + 启动后台流水线"""
    if p.mode == "free":
        if not p.prompt.strip():
            raise HTTPException(400, "自由模式请填写完整提示词")
        prompt = prompt_engine.build_free_prompt(p.prompt)
        cfg = {}
    else:
        cfg = _resolve_structured(p)
        prompt = p.prompt_override.strip() if p.prompt_override.strip() else prompt_engine.build_structured_prompt(cfg)

    # 取当前启用启用的视频模型(默认第一个)
    model = ai_repo.list_configs(enabled_only=True)
    video_models = [m for m in model if m["kind"] == "video"] or model
    if not video_models:
        raise HTTPException(400, "未配置可用的 AI 模型，请先在模型管理中添加")
    model_cfg = video_models[0]

    extra = {"characters": [c["name"] for c in cfg.get("characters", [])],
             "scene": (cfg.get("scene") or {}).get("name", ""),
             "product": (cfg.get("product") or {}).get("name", ""),
             "appear_way": cfg.get("appear_way", ""),
             "template": (cfg.get("template") or {}).get("name", ""),
             "rhythm": (cfg.get("rhythm") or {}).get("name", "")}
    gid = generations_repo.create({
        "mode": p.mode, "title": p.title or (cfg.get("template") or {}).get("name", "") or "未命名",
        "prompt": prompt, "model_id": model_cfg["model_id"],
        "status": "draft", "duration": p.duration, "resolution": p.resolution,
        "ratio": p.ratio, "seed": p.seed, "extra": extra})
    try:
        video_pipeline.start(gid)
    except Exception as e:
        raise HTTPException(400, f"启动生成失败: {e}")
    return generations_repo.get_generation(gid)


@router.get("")
def list_generations(limit: int = 50):
    return generations_repo.list_generations(limit=limit)


@router.get("/{gid}")
def get_generation(gid: int):
    g = generations_repo.get_generation(gid)
    if not g:
        raise HTTPException(404, "记录不存在")
    return g


@router.delete("/{gid}")
def delete_generation(gid: int):
    g = generations_repo.get_generation(gid)
    if not g:
        raise HTTPException(404, "记录不存在")
    if g.get("local_path") and os.path.exists(g["local_path"]):
        try:
            os.remove(g["local_path"])
        except Exception:
            pass
    generations_repo.delete(gid)
    return {"ok": True}