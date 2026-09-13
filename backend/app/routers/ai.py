# -*- coding: utf-8 -*-
"""AI 模型管理路由: 配置 CRUD + 连接测试(枚举模型明文校验, 不产生生成费用)"""
import os
from fastapi import APIRouter, HTTPException

from ..models import AiConfigIn, AiTestIn
from ..repositories import ai_repo
from ..services import doubao_client

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/configs")
def list_configs():
    return ai_repo.list_configs()


@router.post("/configs")
def create_config(payload: AiConfigIn):
    cid = ai_repo.create(payload.model_dump())
    return ai_repo.get_config(cid)


@router.put("/configs/{cid}")
def update_config(cid: int, payload: AiConfigIn):
    if not ai_repo.update(cid, payload.model_dump()):
        raise HTTPException(404, "配置不存在")
    return ai_repo.get_config(cid)


@router.delete("/configs/{cid}")
def delete_config(cid: int):
    if not ai_repo.delete(cid):
        raise HTTPException(404, "配置不存在")
    return {"ok": True}


@router.post("/test")
def test_connection(payload: AiTestIn):
    """校验 API Key 有效性 + 可选校验模型是否在账号模型列表中(只读, 不生成)"""
    api_key = payload.api_key or os.environ.get("DOUBAO_API_KEY", "")
    if not api_key:
        raise HTTPException(400, "未提供 API Key")
    try:
        r = doubao_client.test_key(api_key)
    except doubao_client.DoubaoError as e:
        raise HTTPException(400, f"Key 无效或网络错误: {e.code}")
    if payload.model_id and payload.model_id not in r["models"]:
        raise HTTPException(400, f"模型 {payload.model_id} 不在账号模型列表中")
    return {"ok": True, "total": r["total"],
            "model_available": (not payload.model_id or payload.model_id in r["models"])}