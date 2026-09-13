# -*- coding: utf-8 -*-
"""组装 release/ 目录(每步校验, 失败即退出):
  1. frontend/build/win-unpacked 内容 -> release/
  2. backend/dist/drama-backend   -> release/resources/backend
  3. 建 release/data(首次运行后端自动建库)
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASE = os.path.join(ROOT, "release")
WIN_UNPACKED = os.path.join(ROOT, "frontend", "build", "win-unpacked")
BACKEND_DIST = os.path.join(ROOT, "backend", "dist", "drama-backend")


def step(name, fn):
    print(f">>> {name}")
    fn()
    print(f"    ok")


def main():
    if not os.path.isdir(WIN_UNPACKED):
        print("❌ 缺少 frontend/build/win-unpacked, 先执行 electron-builder")
        sys.exit(1)
    if not os.path.isdir(BACKEND_DIST):
        print("❌ 缺少 backend/dist/drama-backend, 先执行 python backend/build_backend.py")
        sys.exit(1)

    shutil.rmtree(RELEASE, ignore_errors=True)
    os.makedirs(RELEASE)

    def move_frontend():
        for item in os.listdir(WIN_UNPACKED):
            shutil.move(os.path.join(WIN_UNPACKED, item), RELEASE)
        os.rmdir(WIN_UNPACKED)

    def move_backend():
        os.makedirs(os.path.join(RELEASE, "resources"), exist_ok=True)
        shutil.move(BACKEND_DIST, os.path.join(RELEASE, "resources", "backend"))

    def make_data():
        os.makedirs(os.path.join(RELEASE, "data"), exist_ok=True)

    step("前端壳 -> release/", move_frontend)
    step("后端 -> release/resources/backend/", move_backend)
    step("建 data/ 目录", make_data)

    exe = os.path.join(RELEASE, "AiDramaStudio.exe")
    print("\n✅ 组装完成:")
    print(f"   {exe} ({(os.path.getsize(exe) // 1024 // 1024)}MB)")
    print(f"   {os.path.join(RELEASE, 'resources', 'backend', 'drama-backend.exe')}")
    print("   双击 AiDramaStudio.exe 即可运行")


if __name__ == "__main__":
    main()