# -*- coding: utf-8 -*-
"""FastAPI 入口: AI短剧工坊后端"""
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .core import logkit
from .database import init_db, videos_dir
from .routers import ai, catalog, generations, settings
from .services import video_pipeline

logkit.setup()
app = FastAPI(title="AI短剧工坊后端", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 接口日志中间件: 方法 路径 状态 耗时 -> api.log(健康轮询端点跳过)
app.add_middleware(BaseHTTPMiddleware, dispatch=logkit.api_log_middleware)


@app.on_event("startup")
def startup():
    init_db()
    # 恢复上次异常退出时的未完成任务
    try:
        video_pipeline.resume_pending()
    except Exception as e:
        logkit.get_logger("drama.main").warning("resume_pending: %s", e)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/logs/report")
async def frontend_log_report(request: Request):
    """前端渲染进程崩溃现场上报 -> error.log"""
    try:
        payload = await request.json()
    except Exception:
        payload = "?"
    logkit.handle_frontend_report(payload)
    return {"ok": True}


# 本地成品视频静态访问: /api/videos/<id>.mp4
os.makedirs(videos_dir(), exist_ok=True)
app.mount("/api/videos", StaticFiles(directory=videos_dir()), name="videos")

app.include_router(ai.router)
app.include_router(catalog.characters_router)
app.include_router(catalog.products_router)
app.include_router(catalog.scenes_router)
app.include_router(catalog.templates_router)
app.include_router(catalog.rhythms_router)
app.include_router(settings.router)
app.include_router(generations.router)