# -*- coding: utf-8 -*-
"""字典档 CRUD 路由工厂: 人物/产品/场景/文本模板/视频节奏 共用一套增删改查

抽象: 每个资源 = (前端路由前缀, 数据访问函数组, 中文标签)
"""
from fastapi import APIRouter, HTTPException

from ..repositories import catalog_repo


def make_crud_router(prefix: str, tag: str, repo: dict):
    """repo: {list, create, update, delete} 函数组 + plain(K: 是否纯行表无JSON列)"""
    router = APIRouter(prefix=prefix, tags=[tag])

    @router.get("")
    def list_items():
        return repo["list"]()

    @router.post("")
    def create_item(payload: dict):
        try:
            cid = repo["create"](payload)
        except Exception as e:
            raise HTTPException(400, f"创建失败: {e}")
        return {"id": cid}

    @router.put("/{item_id}")
    def update_item(item_id: int, payload: dict):
        if not repo["update"](item_id, payload):
            raise HTTPException(404, "记录不存在")
        return {"ok": True}

    @router.delete("/{item_id}")
    def delete_item(item_id: int):
        if not repo["delete"](item_id):
            raise HTTPException(404, "记录不存在")
        return {"ok": True}

    return router


characters_router = make_crud_router("/api/characters", "characters", {
    "list": catalog_repo.list_characters,
    "create": catalog_repo.create_character,
    "update": catalog_repo.update_character,
    "delete": catalog_repo.delete_character,
})

products_router = make_crud_router("/api/products", "products", {
    "list": catalog_repo.list_products,
    "create": catalog_repo.create_product,
    "update": catalog_repo.update_product,
    "delete": catalog_repo.delete_product,
})

scenes_router = make_crud_router("/api/scenes", "scenes", {
    "list": catalog_repo.list_scenes,
    "create": catalog_repo.create_scene,
    "update": catalog_repo.update_scene,
    "delete": catalog_repo.delete_scene,
})

templates_router = make_crud_router("/api/story-templates", "templates", {
    "list": catalog_repo.list_templates,
    "create": catalog_repo.create_template,
    "update": catalog_repo.update_template,
    "delete": catalog_repo.delete_template,
})

rhythms_router = make_crud_router("/api/video-rhythms", "rhythms", {
    "list": catalog_repo.list_rhythms,
    "create": catalog_repo.create_rhythm,
    "update": catalog_repo.update_rhythm,
    "delete": catalog_repo.delete_rhythm,
})