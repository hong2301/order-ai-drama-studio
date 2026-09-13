# -*- coding: utf-8 -*-
"""视频生成流水线: 编排 提交 -> 轮询 -> 下载 -> 更新记录

设计:
  - start(gid): 同步完成"创建记录 + 提交任务拿到 task_id"; 之后由后台线程轮询
  - _poll_worker: 每10秒查一次豆包状态, 成功则下载到 data/videos/<gid>.mp4
  - 服务重启时恢复: main 启动扫描 status in (queued,running) 的残留任务重新挂轮询
"""
import logging
import os
import threading
import time
import urllib.request

from ..database import videos_dir
from ..repositories import ai_repo, generations_repo
from . import doubao_client

log = logging.getLogger("drama.pipeline")

POLL_INTERVAL = 10
MAX_WAIT_SECONDS = 40 * 60  # 40分钟上限(pro 版 10s 视频可能较慢)

_workers: dict[int, threading.Thread] = {}


def start(gid: int) -> dict:
    """开始生成: 读取记录+配置, 提交任务, 挂后台轮询; 返回 generation 详情"""
    gen = generations_repo.get_generation(gid)
    if not gen:
        raise ValueError(f"生成记录不存在: {gid}")
    cfg = ai_repo.get_by_model_id(gen["model_id"])
    if not cfg:
        raise ValueError(f"未找到启用的模型配置: {gen['model_id']}")
    api_key = cfg.get("api_key") or os.environ.get("DOUBAO_API_KEY", "")
    if not api_key:
        raise ValueError("模型未配置 API Key")

    # 提交任务(同步; 失败则记录 failed 并抛出)
    try:
        task_id = doubao_client.submit_video(
            api_key, gen["model_id"], gen["prompt"],
            resolution=gen["resolution"], duration=gen["duration"],
            ratio=gen["ratio"], seed=gen["seed"])
    except Exception as e:
        generations_repo.update_status(gid, "failed", error=f"提交失败: {e}")
        raise
    generations_repo.update_status(gid, "queued", task_id=task_id)
    _workers[gid] = threading.Thread(target=_poll_worker, args=(gid, task_id, cfg), daemon=True)
    _workers[gid].start()
    log.info("[pipeline] start gid=%s task=%s", gid, task_id)
    return generations_repo.get_generation(gid)


def _poll_worker(gid: int, task_id: str, cfg: dict):
    api_key = cfg.get("api_key") or os.environ.get("DOUBAO_API_KEY", "")
    t0 = time.time()
    while True:
        time.sleep(POLL_INTERVAL)
        try:
            state = doubao_client.query_video(api_key, task_id)
        except Exception as e:
            log.warning("[pipeline] query gid=%s err=%s", gid, e)
            if time.time() - t0 > MAX_WAIT_SECONDS:
                generations_repo.update_status(gid, "failed", error=f"查询异常: {e}")
            continue
        st = state["status"]
        if st == "succeeded":
            _download(gid, state)
            return
        if st == "failed":
            generations_repo.update_status(gid, "failed", error="豆包侧生成失败，请重试")
            return
        # queued/running: 心跳更新
        generations_repo.update_status(gid, "running" if st == "running" else "queued")
        if time.time() - t0 > MAX_WAIT_SECONDS:
            generations_repo.update_status(gid, "failed", error="等待超时(40分钟)")
            return


def _download(gid: int, state: dict) -> None:
    url = state.get("video_url", "")
    if not url:
        generations_repo.update_status(gid, "failed", error="成功但无视频地址")
        return
    os.makedirs(videos_dir(), exist_ok=True)
    local = os.path.join(videos_dir(), f"{gid}.mp4")
    try:
        urllib.request.urlretrieve(url, local)
        size = os.path.getsize(local)
        if size < 1024:
            raise ValueError("文件过小, 疑似无效")
        generations_repo.update_status(gid, "downloaded",
                                       video_url=url, local_path=local, seed=state.get("seed", -1))
        log.info("[pipeline] gid=%s 已下载 %s (%d bytes)", gid, local, size)
    except Exception as e:
        log.warning("[pipeline] download gid=%s err=%s", gid, e)
        if os.path.exists(local):
            try:
                os.remove(local)
            except Exception:
                pass
        generations_repo.update_status(gid, "failed", error=f"下载失败: {e}")


def resume_pending() -> None:
    """启动时恢复未完成任务(上次异常退出/重启)"""
    for gen in generations_repo.list_generations(limit=200):
        if gen["status"] in ("queued", "running") and gen.get("task_id"):
            cfg = ai_repo.get_by_model_id(gen["model_id"])
            if cfg:
                _workers[gen["id"]] = threading.Thread(
                    target=_poll_worker, args=(gen["id"], gen["task_id"], cfg), daemon=True)
                _workers[gen["id"]].start()
                log.info("[pipeline] 恢复任务 gid=%s task=%s", gen["id"], gen["task_id"])