# -*- coding: utf-8 -*-
"""后端启动入口: python backend/run.py (dev 端口默认 8031, 可用 .env 的 BACKEND_PORT 覆盖)"""
import os
import socket
import sys

import uvicorn

# 1) 先加载根 .env(含 DOUBAO_API_KEY / BACKEND_PORT / DRAMA_ENV 等)
from app.load_env import load_root_env
load_root_env()

os.environ.setdefault("BACKEND_PORT", "8031")
os.environ.setdefault("DRAMA_ENV", "dev")
os.environ.setdefault("APP_DEV_RELOAD", "1")  # reload=True 标记: reloader父进程不持有日志文件(轮转冲突)

HOST = "127.0.0.1"
PORT = int(os.environ.get("BACKEND_PORT", "8031"))


def port_in_use(host, port):
    try:
        s = socket.create_connection((host, port), timeout=0.5)
        s.close()
        return True
    except OSError:
        return False


if __name__ == "__main__":
    if port_in_use(HOST, PORT):
        print(f"\n❌ 端口 {PORT} 已被占用! 可能已有后端在运行, 请先关闭旧进程\n")
        sys.exit(1)
    if "app" not in sys.path and os.path.isdir(os.path.join(os.path.dirname(__file__), "app")):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True, log_config=None)