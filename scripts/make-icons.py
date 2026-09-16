#!/usr/bin/env python3
"""项目图标生成器 (macOS 规范: 居中 + 圆角 + 透明边距)

用法:
  python3 scripts/make-icons.py [源图标路径]
  - 源: .svg(自动用 qlmanage 渲染 1024) 或 .png/.jpg(直接使用)
  - 默认源: ~/Desktop/shot.svg
输出(覆盖写):
  next/app/icon.png        48px  favicon(圆角)
  electron/icon.png        512px 窗口+Dock 图标(圆角卡)
  electron/icon.icns       mac 打包图标
  electron/icon.ico        win 打包图标(多尺寸)
macOS 图标规范: 内容约占画布 82%, 四周留透明边距, 圆角 ≈ 18%
"""
import os
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.expanduser("~/Desktop/shot.svg")

CANVAS = 1024
SCALE = 0.82        # 内容占画布比例(留边距)
RADIUS_RATIO = 0.18  # 圆角半径占比


def render_source(src: str) -> Image.Image:
    if src.lower().endswith(".svg"):
        tmp = tempfile.mkdtemp()
        subprocess.run(["qlmanage", "-t", "-s", str(CANVAS), "-o", tmp, src],
                       check=True, capture_output=True)
        png = os.path.join(tmp, os.path.basename(src) + ".png")
        im = Image.open(png).convert("RGBA")
    else:
        im = Image.open(src).convert("RGBA")
    return im


def content_bbox(img: Image.Image):
    """深色(非白/透明)内容边界与重心"""
    px = img.load(); w, h = img.size
    minx, miny, maxx, maxy = w, h, 0, 0
    sum_x = sum_y = n = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 10 and (r < 240 or g < 240 or b < 240):
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
                sum_x += x; sum_y += y; n += 1
    return (minx, miny, maxx, maxy), (sum_x / n, sum_y / n)


def center_crop_to_content(src: Image.Image, tol: int = 24) -> Image.Image:
    """把内容(深色图标)裁切到画布中央: 找到内容 bbox, 加 tol 边距, 输出居中的方形画布"""
    (minx, miny, maxx, maxy), _ = content_bbox(src)
    cw, ch = maxx - minx + 1, maxy - miny + 1
    side = max(cw, ch) + tol * 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(src.crop((minx, miny, maxx + 1, maxy + 1)), ((side - cw) // 2, (side - ch) // 2))
    return canvas


def rounded_card(src_img: Image.Image, canvas: int, scale: float, radius_ratio: float) -> Image.Image:
    """居中缩放 + 圆角遮罩, 输出带透明边距的画布(先裁内容居中, 再缩放)"""
    centered = center_crop_to_content(src_img)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    size = max(8, int(canvas * scale))
    thumb = centered.resize((size, size), Image.LANCZOS)
    offset = (canvas - size) // 2
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=max(4, int(size * radius_ratio)), fill=255)
    out.paste(thumb, (offset, offset), mask)
    return out


def main() -> int:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        print(f"源图标不存在: {src}")
        return 1
    print("渲染源:", src)
    base = render_source(src)

    # 512 圆角卡 (窗口 + Dock)
    card512 = rounded_card(base, 512, SCALE, RADIUS_RATIO)
    card512.save(os.path.join(ROOT, "electron", "icon.png"))
    print("-> electron/icon.png (512, 圆角卡)")

    # favicon 48
    card48 = rounded_card(base, 48, SCALE, RADIUS_RATIO)
    card48.save(os.path.join(ROOT, "next", "app", "icon.png"))
    print("-> next/app/icon.png (48 favicon)")

    # ICNS (10 尺寸 iconset -> iconutil)
    iconset = tempfile.mkdtemp(suffix=".iconset")
    spec = [(16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png")]
    for px, fn in spec:
        rounded_card(base, px, SCALE, RADIUS_RATIO).save(os.path.join(iconset, fn))
    icns_out = os.path.join(ROOT, "electron", "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns_out], check=True)
    print("-> electron/icon.icns")

    # ICO (win 多尺寸): PIL 保存 ICO 只按 sizes 参数从单张图缩放生成(append_images 对 ICO 不生效)
    ico_out = os.path.join(ROOT, "electron", "icon.ico")
    rounded_card(base, 256, SCALE, RADIUS_RATIO).save(
        ico_out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("-> electron/icon.ico")

    print("✅ 全部图标已生成")
    return 0


if __name__ == "__main__":
    sys.exit(main())