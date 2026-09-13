# -*- coding: utf-8 -*-
"""
《嘴硬家属》示例二「枸杞原浆关心款」完整15秒成片
段A(10s) + 段B(5s) 拼接 + ffmpeg 结尾字幕
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error

API = "https://ark.cn-beijing.volces.com/api/v3"
KEY = os.environ["DOUBAO_API_KEY"]
MODEL = "doubao-seedance-1-0-pro-fast-251015"

# 统一人物/环境设定，保证两段人物一致
PERSON = "中年夫妻：丈夫约48岁穿深色夹克，妻子约46岁穿米色针织衫。家中暖色调，现代家庭客厅与厨房，傍晚暖光，电影级质感，生活流家庭短剧，克制叙事，浅景深，镜头平稳。竖屏9:16。"

PROMPT_A = """{person}

镜头一：妻子下班回家，神情疲惫地走进客厅，把包放在沙发上。丈夫坐在餐桌旁抬头看她，沉默不语。
镜头二：妻子转身走进卫生间洗漱，丈夫低头悄悄拿出手机，在购物页面下单。
镜头三：门铃响，丈夫轻轻放下手机去开门，接过快递，从快递箱里拿出一盒枸杞原浆。
镜头四：丈夫把枸杞原浆放进冰箱，动作放轻，贴上一张手写小纸条。""".format(person=PERSON)

PROMPT_B = """{person}

镜头一：妻子打开冰箱门，看到那盒枸杞原浆和旁边的手写小纸条，纸条上写着“记得喝”。她微微一愣，嘴角浮现温柔的笑意。
镜头二：丈夫已经走到门口，弯腰系鞋带，背对镜头轻声说：“顺手买的，别多想。”
镜头三：妻子目送丈夫出门，画面定格在妻子温柔的笑脸上。""".format(person=PERSON)


def req(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:400]}")


def gen(prompt, duration, out):
    body = {"model": MODEL,
            "content": [{"type": "text", "text": prompt}],
            "resolution": "720p", "duration": duration,
            "watermark": True, "seed": -1, "fps": 24, "ratio": "9:16"}
    tid = req("POST", "/contents/generations/tasks", body)["id"]
    print(f"== {out}: 任务 {tid} ({duration}s) 已提交", flush=True)
    while True:
        time.sleep(10)
        r = req("GET", f"/contents/generations/tasks/{tid}")
        st = r["status"]
        print(f"   [{tid}] {st}", flush=True)
        if st == "succeeded":
            url = r["content"]["video_url"]
            urllib.request.urlretrieve(url, out)
            print(f"   {out} 已下载", flush=True)
            return
        if st == "failed":
            raise RuntimeError(f"{out} 生成失败: {json.dumps(r, ensure_ascii=False)[:300]}")


def concat_with_subtitle(parts, out, subtitle):
    # 统一帧率/分辨率后拼接
    norm = []
    for i, p in enumerate(parts):
        n = f"_norm{i}.mp4"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", p,
                        "-vf", "fps=24,scale=704:1248:flags=lanczos,setsar=1",
                        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", n], check=True)
        norm.append(n)
    concat_file = "concat.txt"
    with open(concat_file, "w", encoding="utf-8") as f:
        for n in norm:
            f.write(f"file '{n}'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", concat_file, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
                    "_joined.mp4"], check=True)
    # 找系统可用中文字体
    fonts = ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf",
             "C:/Windows/Fonts/simsun.ttc", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"]
    font = next((f for f in fonts if os.path.exists(f)), None)
    if font is None:
        print("!! 未找到中文字体，跳过字幕叠加")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", "_joined.mp4", "-c", "copy", out], check=True)
    else:
        esc = subtitle.replace("'", "\\u2019")
        font_esc = font.replace(':', '\:')
        vf = (f"drawtext=fontfile='{font_esc}':text='{esc}':fontsize=54:fontcolor=white:"
              f"borderw=3:bordercolor=black@0.6:shadowx=2:shadowy=2:"
              f"x=(w-text_w)/2:y=h-220:enable='gte(t,{max(0.0, 12.0)})'")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", "_joined.mp4",
                        "-vf", vf, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", out], check=True)
    for n in norm:
        os.remove(n)
    os.remove(concat_file)
    os.remove("_joined.mp4") if os.path.exists("_joined.mp4") else None
    print(f"== 成片已生成: {out}", flush=True)


def main():
    gen(PROMPT_A, 10, "part_a_10s.mp4")
    gen(PROMPT_B, 5, "part_b_5s.mp4")
    concat_with_subtitle(["part_a_10s.mp4", "part_b_5s.mp4"],
                         "output_15s_full.mp4",
                         "生活细碎里，藏着不动声色的温柔")


if __name__ == "__main__":
    main()