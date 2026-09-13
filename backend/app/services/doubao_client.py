# -*- coding: utf-8 -*-
"""豆包(火山方舟 Ark) API 客户端

职责单一: 封装 HTTP 交互
  - list_models: 校验 key 有效 + 枚举模型
  - submit_video: 提交文字生成视频任务
  - query_video: 查询任务状态
  - chat: 文本对话(用于文本能力测试/扩写)
"""
import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger("drama.doubao")

ARK_API = "https://ark.cn-beijing.volces.com/api/v3"


def _request(api_key: str, path: str, method: str = "GET", body=None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        ARK_API + path, data=data, method=method,
        headers={"Authorization": "Bearer " + (api_key or ""),
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_text = e.read().decode()[:300]
        try:
            code = json.loads(err_text).get("error", {}).get("code", "")
        except Exception:
            code = f"HTTP{e.code}"
        log.warning("[doubao] %s %s -> %s", method, path, code)
        raise DoubaoError(code, e.code, err_text)


class DoubaoError(Exception):
    """豆包 API 错误: code(业务码) / http(状态码) / detail(原始)"""

    def __init__(self, code: str, http: int, detail: str):
        super().__init__(f"{code} (HTTP {http})")
        self.code = code
        self.http = http
        self.detail = detail


def test_key(api_key: str) -> dict:
    """校验 key: 成功返回 {ok, total, models(全部)}; 失败抛 DoubaoError"""
    r = _request(api_key, "/models", timeout=30)
    models = [m.get("id") for m in r.get("data", [])]
    return {"ok": True, "total": len(models), "models": models}


def submit_video(api_key: str, model_id: str, prompt: str,
                 resolution: str = "720p", duration: int = 5,
                 ratio: str = "9:16", seed: int = -1, fps: int = 24) -> str:
    """提交文字生成视频任务 -> task_id"""
    body = {
        "model": model_id,
        "content": [{"type": "text", "text": prompt}],
        "resolution": resolution,
        "duration": duration,
        "ratio": ratio,
        "watermark": True,
        "seed": seed,
        "fps": fps,
    }
    r = _request(api_key, "/contents/generations/tasks", "POST", body, timeout=60)
    tid = r.get("id")
    if not tid:
        raise DoubaoError("NoTaskId", 200, json.dumps(r, ensure_ascii=False))
    return tid


def query_video(api_key: str, task_id: str) -> dict:
    """查询任务: {task_id, status, video_url?, seed?, usage?}"""
    r = _request(api_key, f"/contents/generations/tasks/{task_id}", timeout=30)
    content = r.get("content") or {}
    return {
        "task_id": r.get("id"),
        "status": r.get("status"),
        "video_url": content.get("video_url", ""),
        "seed": r.get("seed", -1),
        "usage": r.get("usage") or {},
        "raw": r,
    }


def chat(api_key: str, model_id: str, text: str, timeout: int = 60) -> str:
    """文本对话(标准 chat/completions), 返回回复文本"""
    body = {"model": model_id, "messages": [{"role": "user", "content": text}], "max_tokens": 200}
    r = _request(api_key, "/chat/completions", "POST", body, timeout=timeout)
    try:
        return r["choices"][0]["message"]["content"]
    except Exception:
        raise DoubaoError("BadChatResponse", 200, json.dumps(r, ensure_ascii=False)[:300])