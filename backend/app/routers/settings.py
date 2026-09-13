# -*- coding: utf-8 -*-
"""全局设置路由: settings 表 key-value(存界面偏好, 如上次使用的模型id)"""
from fastapi import APIRouter
from pydantic import BaseModel

import os

from ..database import get_conn

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingIn(BaseModel):
    value: str = ""


@router.get("/{key}")
def get_setting(key: str):
    conn = get_conn()
    try:
        r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return {"key": key, "value": r["value"] if r else ""}
    finally:
        conn.close()


@router.put("/{key}")
def set_setting(key: str, p: SettingIn):
    conn = get_conn()
    try:
        conn.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, p.value))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


class RevealIn(BaseModel):
    path: str = ""


@router.post("/reveal")
def reveal_in_folder(p: RevealIn):
    """打开文件资源管理器并选中本地文件(exe/开发均可用, 无需 Electron IPC)"""
    if not p.path or not os.path.exists(p.path):
        return {"ok": False, "msg": "文件不存在"}
    try:
        import subprocess as _sp
        _sp.Popen(["explorer", "/select,", os.path.normpath(p.path)])
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "msg": str(e)}