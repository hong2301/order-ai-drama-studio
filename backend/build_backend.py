# -*- coding: utf-8 -*-
"""打包 FastAPI 后端为单目录可执行程序 (PyInstaller onedir)

产物: backend/dist/drama-backend/  (由 Electron 在 resources/backend 下分发并 spawn)
用法: cd backend && python build_backend.py
"""
import os
import shutil
import subprocess
import sys

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BACKEND_DIR, "dist", "drama-backend")


def main():
    for p in (DIST, os.path.join(BACKEND_DIR, "build"), os.path.join(BACKEND_DIR, "drama-backend.spec")):
        if os.path.exists(p):
            shutil.rmtree(p, ignore_errors=True)
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean",
        "--name", "drama-backend",
        "--onedir",
        "--distpath", os.path.join(BACKEND_DIR, "dist"),
        "--workpath", os.path.join(BACKEND_DIR, "build"),
        "--specpath", os.path.join(BACKEND_DIR),
        "--paths", BACKEND_DIR,
        "--collect-all", "uvicorn",
        "--collect-submodules", "fastapi",
        "--collect-submodules", "pydantic",
        "--hidden-import", "app.main",   # uvicorn.run("app.main:app") 字符串引用, 需显式收集
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        os.path.join(BACKEND_DIR, "run_packaged.py"),
    ]
    print(" ".join(cmd))
    subprocess.run(cmd, check=True)
    exe = os.path.join(DIST, "drama-backend.exe")
    print(f"[build_backend] 完成: {exe}({os.path.getsize(exe)//1024//1024}MB)")


if __name__ == "__main__":
    main()