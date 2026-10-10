// 视频抽帧: 用于长剧本"分镜衔接"—— 把上一段成片的最后一帧抽出来,
// 作为下一段的参考图之一(reference_image)并在提示词里指定它为本段起始画面。
//
// 注意: 不能用 role:"first_frame" —— 方舟规定「首帧图」与「参考图」是互斥场景, 不能混用;
// 官方给的间接做法就是: 参考图 + 提示词里说明「以 @图像N 作为首帧」。
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { dataDir } from "@/lib/server/db";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as unknown as string) || "ffmpeg";
    const p = spawn(bin, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-200)}`))));
  });
}

/** 本地 /api/uploads/... → 绝对路径 */
function absOf(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  return path.join(dataDir(), "uploads", m[1], m[2]);
}

/**
 * 抽最后一帧存成 jpg(放 uploads/images), 返回可直接当参考图用的 /api/uploads/... 路径。
 * 失败返回 null(调用方降级为"不衔接", 不影响本段生成)。
 */
export async function extractLastFrame(videoUrl: string, name: string): Promise<string | null> {
  try {
    const src = absOf(videoUrl);
    if (!src || !fs.existsSync(src)) return null;
    const dir = path.join(dataDir(), "uploads", "images");
    fs.mkdirSync(dir, { recursive: true });
    const fname = `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const dst = path.join(dir, fname);
    // -sseof -0.15: 从结尾前 0.15 秒开始; -frames:v 1: 只取一帧
    await runFfmpeg(["-y", "-sseof", "-0.15", "-i", src, "-frames:v", "1", "-q:v", "2", dst]);
    if (!fs.existsSync(dst)) return null;
    void name; // 名字暂不落库(只是临时参考图)
    return `/api/uploads/images/${fname}`;
  } catch {
    return null;
  }
}
