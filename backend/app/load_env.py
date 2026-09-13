# -*- coding: utf-8 -*-
"""加载项目根 .env 到 os.environ(已存在的变量不覆盖)

必须在 import app 其他模块之前调用; run.py / run_packaged.py 都会先调它
"""
import os

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_root_env():
    env_path = os.path.join(_BASE, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v