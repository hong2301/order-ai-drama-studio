# -*- coding: utf-8 -*-
"""Pydantic 请求模型"""
from typing import List, Optional
from pydantic import BaseModel


class GenerationCreate(BaseModel):
    """生成请求: mode=structured 传各字典档 id; mode=free 直接传 prompt"""
    mode: str = "structured"          # structured | free
    title: str = ""
    prompt: str = ""                  # free 模式必填
    prompt_override: str = ""         # 结构化模式下手动改写提示词(可选; 给了则用它)
    # 结构化配置引用
    character_ids: List[int] = []
    product_id: Optional[int] = None
    appear_way: str = ""              # 产品出现方式(不填则用产品默认第一条)
    scene_id: Optional[int] = None
    template_id: Optional[int] = None
    rhythm_id: Optional[int] = None
    # 生成参数(默认优先生成时选择)
    duration: int = 5
    resolution: str = "720p"
    ratio: str = "9:16"
    seed: int = -1


class AiConfigIn(BaseModel):
    name: str = ""
    provider: str = "doubao"
    api_key: str = ""
    model_id: str = ""
    kind: str = "video"
    capability: dict = {}
    cost_note: str = ""
    desc: str = ""
    enabled: bool = True
    sort_order: int = 999


class AiTestIn(BaseModel):
    api_key: str = ""
    model_id: str = ""