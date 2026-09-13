# -*- coding: utf-8 -*-
"""探测账号已开通的 Seedance 模型（从上到下依次尝试，第一个成功即停止并轮询）"""
import json, os, time, urllib.request, urllib.error, sys

API = "https://ark.cn-beijing.volces.com/api/v3"
KEY = os.environ["DOUBAO_API_KEY"]

CANDIDATES = [
    "doubao-seedance-1-0-lite-t2v-250428",
    "doubao-seedance-1-0-pro-fast-251015",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-5-260628",
    "wan2-1-14b-t2v-250225",
]

PROMPT = "竖屏9:16，电影级质感，柔和暖色调家庭厨房，傍晚暖光。中年妻子下班回家神情疲惫，中年丈夫沉默地从袋中拿出枸杞原浆放进冰箱并贴上写有“记得喝”的纸条。妻子打开冰箱看到后微微一愣，嘴角浮现温柔笑意。丈夫在门口穿鞋背对镜头轻声说：“顺手买的，别多想。”风格：生活流家庭短剧，克制叙事，温暖反转，浅景深，镜头平稳。"


def post(model, duration, resolution):
    body = {
        "model": model,
        "content": [{"type": "text", "text": PROMPT}],
        "resolution": resolution,
        "duration": duration,
        "watermark": True,
        "seed": -1,
        "fps": 24,
    }
    req = urllib.request.Request(
        API + "/contents/generations/tasks", data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"http_error": e.code, "body": e.read().decode()}


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else "5s-720p"
    if what == "5s-720p":
        duration, resolution = 5, "720p"
    elif what == "10s-1080p":
        duration, resolution = 10, "1080p"
    else:
        duration, resolution = 5, "720p"
    for m in CANDIDATES:
        print(f"==> 尝试 {m} ({duration}s {resolution}) ...", flush=True)
        r = post(m, duration, resolution)
        if "http_error" in r:
            try:
                err = json.loads(r["body"]).get("error", {})
                code = err.get("code", "")
            except Exception:
                code = ""
            print(f"    -> 拒绝: {code}  ({r['body'][:160]})")
            if code != "ModelNotOpen":
                # 其它错误（如参数问题）也继续下一个模型
                continue
            continue
        print("    -> 接受! task_id =", r.get("id"), flush=True)
        print("TASK_ID=" + r.get("id", ""))
        return 0
    print("==> 所有候选模型均未开通。需要去火山方舟控制台开通 Seedance 服务。")
    return 1


if __name__ == "__main__":
    sys.exit(main())