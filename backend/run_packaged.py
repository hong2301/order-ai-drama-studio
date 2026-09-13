# -*- coding: utf-8 -*-
"""打包版后端入口(PyInstaller exe 指向此文件; 无 reload, prod 模式)

看门狗: 若环境变量 DRAMA_PARENT_PID(Electron 主进程 PID) 存在,
则监听父进程存活, 父进程消失后本进程自动退出(防孤儿残留)。
"""
import multiprocessing
import os
import sys
import threading
import time

import uvicorn

multiprocessing.freeze_support()   # PyInstaller frozen 环境下 multiprocessing spawn 必需


def _is_parent_alive(pid):
    """Windows: 检查指定 PID 的进程是否存活(OpenProcess 失败即视为已死)"""
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    try:
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(h)
        return bool(ok and code.value == 259)  # 259 = STILL_ACTIVE
    except Exception:
        return True  # 异常时保守视为存活


def start_watchdog(parent_pid):
    """后台线程: 父进程(主程序)消失后自动退出, 防止孤儿残留"""
    def loop():
        while True:
            time.sleep(3)
            if not _is_parent_alive(parent_pid):
                os._exit(0)
    threading.Thread(target=loop, daemon=True).start()


def _main():
    parent = os.environ.get("DRAMA_PARENT_PID")
    if parent and parent.isdigit():
        start_watchdog(int(parent))
    # 打包版: app 包在 exe 内部, sys.path 已含; 尝试加载根 .env(不存在则跳过)
    try:
        from app.load_env import load_root_env
        load_root_env()
    except Exception:
        pass
    os.environ.setdefault("BACKEND_PORT", "8031")
    os.environ.setdefault("DRAMA_ENV", "prod")
    port = int(os.environ.get("BACKEND_PORT", "8031"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=False, log_config=None)


if __name__ == "__main__":
    _main()