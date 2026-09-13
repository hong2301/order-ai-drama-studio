// 视频生成流水线: 提交 -> 轮询 -> 下载 -> 更新记录(移植自 backend/app/services/video_pipeline.py)
// 常驻 Node 进程内运行(setTimeout 轮询); 服务重启时恢复未完成任务
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline as streamPipeline } from "stream/promises";
import { videosDir } from "./db";
import { logger } from "./logger";
import * as doubao from "./doubao";
import * as aiRepo from "./ai";
import * as generationsRepo from "./generations";
import type { AiConfig, Generation } from "../../app/lib/types";

const POLL_INTERVAL = 10_000;
const MAX_WAIT_SECONDS = 40 * 60;   // 40 分钟上限

const running = new Set<number>();

function apiKeyOf(cfg: AiConfig): string {
  return cfg.api_key || process.env.DOUBAO_API_KEY || "";
}

/** 开始生成: 读取记录+配置, 提交任务, 挂后台轮询; 返回 generation 详情 */
export async function start(gid: number): Promise<Generation> {
  const gen = await generationsRepo.getGeneration(gid);
  if (!gen) throw new Error(`生成记录不存在: ${gid}`);
  const cfg = await aiRepo.getByModelId(gen.model_id);
  if (!cfg) throw new Error(`未找到启用的模型配置: ${gen.model_id}`);
  const apiKey = apiKeyOf(cfg);
  if (!apiKey) throw new Error("模型未配置 API Key");

  let taskId: string;
  try {
    taskId = await doubao.submitVideo(apiKey, gen.model_id, gen.prompt, {
      resolution: gen.resolution, duration: gen.duration, ratio: gen.ratio, seed: gen.seed,
    });
  } catch (e) {
    await generationsRepo.updateStatus(gid, "failed", { error: `提交失败: ${(e as Error).message}` });
    throw e;
  }
  await generationsRepo.updateStatus(gid, "queued", { task_id: taskId });
  logger.info("[pipeline] start gid=%s task=%s", gid, taskId);
  void pollWorker(gid, taskId, cfg);
  return (await generationsRepo.getGeneration(gid))!;
}

async function pollWorker(gid: number, taskId: string, cfg: AiConfig): Promise<void> {
  if (running.has(gid)) return;
  running.add(gid);
  const apiKey = apiKeyOf(cfg);
  const t0 = Date.now();
  try {
    for (;;) {
      await sleep(POLL_INTERVAL);
      let state: doubao.VideoState;
      try {
        state = await doubao.queryVideo(apiKey, taskId);
      } catch (e) {
        logger.warn("[pipeline] query gid=%s err=%s", gid, (e as Error).message);
        if (Date.now() - t0 > MAX_WAIT_SECONDS * 1000) {
          await generationsRepo.updateStatus(gid, "failed", { error: `查询异常: ${(e as Error).message}` });
          return;
        }
        continue;
      }
      if (state.status === "succeeded") { await download(gid, state); return; }
      if (state.status === "failed") {
        await generationsRepo.updateStatus(gid, "failed", { error: "豆包侧生成失败，请重试" });
        return;
      }
      await generationsRepo.updateStatus(gid, state.status === "running" ? "running" : "queued");
      if (Date.now() - t0 > MAX_WAIT_SECONDS * 1000) {
        await generationsRepo.updateStatus(gid, "failed", { error: "等待超时(40分钟)" });
        return;
      }
    }
  } finally {
    running.delete(gid);
  }
}

async function download(gid: number, state: doubao.VideoState): Promise<void> {
  const url = state.video_url;
  if (!url) {
    await generationsRepo.updateStatus(gid, "failed", { error: "成功但无视频地址" });
    return;
  }
  fs.mkdirSync(videosDir(), { recursive: true });
  const local = path.join(videosDir(), `${gid}.mp4`);
  try {
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
    await streamPipeline(Readable.fromWeb(resp.body as never), fs.createWriteStream(local));
    const size = fs.statSync(local).size;
    if (size < 1024) throw new Error("文件过小, 疑似无效");
    await generationsRepo.updateStatus(gid, "downloaded", {
      video_url: url, local_path: local, seed: state.seed,
    });
    logger.info("[pipeline] gid=%s 已下载 %s (%d bytes)", gid, local, size);
  } catch (e) {
    logger.warn("[pipeline] download gid=%s err=%s", gid, (e as Error).message);
    try { if (fs.existsSync(local)) fs.unlinkSync(local); } catch { /* ignore */ }
    await generationsRepo.updateStatus(gid, "failed", { error: `下载失败: ${(e as Error).message}` });
  }
}

/** 启动时恢复未完成任务(上次异常退出/重启) */
export async function resumePending(): Promise<void> {
  const gens = await generationsRepo.listGenerations(200);
  for (const g of gens) {
    if ((g.status === "queued" || g.status === "running") && g.task_id) {
      const cfg = await aiRepo.getByModelId(g.model_id);
      if (cfg) {
        logger.info("[pipeline] 恢复任务 gid=%s task=%s", g.id, g.task_id);
        void pollWorker(g.id, g.task_id, cfg);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}