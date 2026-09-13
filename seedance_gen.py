# -*- coding: utf-8 -*-
"""
《嘴硬家属》15秒家庭短剧 —— 豆包 Seedance 文字生成视频
用法:
  python seedance_gen.py [--model doubao-seedance-2-0-fast-260128] [--duration 5] [--resolution 720p] [--out out.mp4]
"""
import argparse, json, sys, time, urllib.request, urllib.error

API = "https://ark.cn-beijing.volces.com/api/v3"

PROMPT_EXAMPLE2 = """竖屏9:16短视频，电影级质感，柔和暖色调，现代家庭生活场景，傍晚暖光。

镜头一：中年妻子下班回家，神情疲惫地走进客厅；中年丈夫坐在餐桌旁抬头看她，沉默不语。
镜头二：丈夫转身从袋子里拿出枸杞原浆，轻轻放进冰箱，并贴上一张手写纸条。
镜头三：妻子打开冰箱，看到枸杞原浆和纸条（纸条上写着"记得喝"），微微一愣，嘴角浮现温柔笑意。
镜头四：丈夫在门口穿鞋，背对镜头轻声说："顺手买的，别多想。"片尾字幕浮现："生活细碎里，藏着不动声色的温柔。"

人物：中年夫妻（丈夫穿深色夹克，妻子穿米色针织衫），居家装扮，表情真实自然。
风格：生活流家庭短剧，克制叙事，温暖反转，浅景深，镜头平稳缓慢，无广告感。"""


def req(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"Authorization": "Bearer " + __import__("os").environ["DOUBAO_API_KEY"],
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise RuntimeError(f"HTTP {e.code}: {err}")


def submit(model, duration, resolution, prompt, ratio="9:16"):
    body = {
        "model": model,
        "content": [{"type": "text", "text": prompt}],
        "resolution": resolution,
        "duration": duration,
        "watermark": True,
        "seed": -1,
        "fps": 24,
        "ratio": ratio,
    }
    print(">> 提交任务", json.dumps(body, ensure_ascii=False)[:200], "...")
    r = req("POST", "/contents/generations/tasks", body)
    print("<< 响应:", json.dumps(r, ensure_ascii=False)[:500])
    tid = r.get("id")
    if not tid:
        raise RuntimeError("未拿到 task id")
    return tid


def poll(tid, interval=10, max_minutes=30):
    t0 = time.time()
    last = ""
    while True:
        r = req("GET", f"/contents/generations/tasks/{tid}")
        st = r.get("status")
        prog = r.get("progress")
        line = f"[{int(time.time()-t0)}s] status={st} progress={prog}"
        if line != last:
            print(line, flush=True)
            last = line
        if st == "succeeded":
            return r
        if st == "failed":
            raise RuntimeError("生成失败: " + json.dumps(r, ensure_ascii=False))
        if time.time() - t0 > max_minutes * 60:
            raise TimeoutError("超时")
        time.sleep(interval)


def download(url, out):
    print(">> 下载视频:", url[:120], "...")
    import urllib.request as ur
    ur.urlretrieve(url, out)
    import os
    print("<< 已保存:", out, os.path.getsize(out), "bytes")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="doubao-seedance-2-0-fast-260128")
    ap.add_argument("--duration", type=int, default=5)
    ap.add_argument("--resolution", default="720p")
    ap.add_argument("--ratio", default="9:16")
    ap.add_argument("--prompt-file", default=None, help="可选：提示词文本文件")
    ap.add_argument("--out", default="output_seedance.mp4")
    ap.add_argument("--poll-only", default=None, help="只轮询已提交的 task id")
    args = ap.parse_args()

    if args.poll_only:
        r = poll(args.poll_only)
        print("<< 结果:", json.dumps(r, ensure_ascii=False)[:800])
        url = (r.get("content") or {}).get("video_url")
        if url:
            download(url, args.out)
        return

    prompt = PROMPT_EXAMPLE2
    if args.prompt_file:
        with open(args.prompt_file, encoding="utf-8") as f:
            prompt = f.read().strip()

    print("== 提示词 ==")
    print(prompt)
    print("==")
    tid = submit(args.model, args.duration, args.resolution, prompt, ratio=args.ratio)
    r = poll(tid)
    print("<< 结果:", json.dumps(r, ensure_ascii=False)[:800])
    url = (r.get("content") or {}).get("video_url")
    if url:
        download(url, args.out)


if __name__ == "__main__":
    main()