// 长剧本拼接: POST /api/scripts/[id]/merge
// 把该剧本各段已生成的成片按 segment 顺序用 ffmpeg 拼成一个长视频 → 入视频库(与剧本绑定)
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { dataDir, getDb, persist, queryAll } from "@/lib/server/db";
import { TABLE, ensureVideoTables } from "@/lib/server/video";

export const dynamic = "force-dynamic";

/** 本地 /api/uploads/... → 绝对路径 */
function localFile(url: string): string | null {
  const m = /^\/api\/uploads\/([\w-]+)\/([\w.-]+)$/.exec(url);
  if (!m) return null;
  const f = path.join(dataDir(), "uploads", m[1], m[2]);
  return fs.existsSync(f) ? f : null;
}

/** 跑 ffmpeg(concat 无损拼接: 同一模型产出, 编码参数一致) */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as unknown as string) || "ffmpeg";
    const p = spawn(bin, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-300)}`))));
  });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const sid = Number(id);
  if (!Number.isInteger(sid) || sid <= 0) return Response.json({ ok: false, detail: "非法 id" }, { status: 400 });

  try {
    await ensureVideoTables();
    const db = await getDb();
    const script = queryAll(db, "SELECT name FROM scripts WHERE id=?", [sid])[0];
    if (!script) return Response.json({ ok: false, detail: "剧本不存在" }, { status: 404 });
    const scriptName = String(script.name || "");

    // 该剧本各段的成片(按段号排序)
    const rows = queryAll(
      db,
      `SELECT * FROM ${TABLE} WHERE script_id=? AND kind='long' AND segment>0 AND status='succeeded' ORDER BY segment ASC`,
      [sid],
    );
    if (!rows.length) return Response.json({ ok: false, detail: "还没有已生成的段，请先在控制台开始生成" }, { status: 400 });

    // 每段取本地文件(段内可能重跑过多次, 同一段取最后一条)
    const bySeg = new Map<number, string>();
    for (const r of rows) {
      const seg = Number(r.segment || 0);
      const f = localFile(String(r.video_url || ""));
      if (f) bySeg.set(seg, f);
    }
    const files = [...bySeg.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    if (!files.length) return Response.json({ ok: false, detail: "段成片本地文件缺失(可能未下载完成)" }, { status: 400 });

    // concat 清单(ffmpeg 要求: 路径用单引号包裹, 内部单引号转义)
    const dir = path.join(dataDir(), "uploads", "videos");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const listFile = path.join(dir, `merge-${sid}-${stamp}.txt`);
    const outFile = path.join(dir, `merged-${sid}-${stamp}.mp4`);
    fs.writeFileSync(
      listFile,
      files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );

    try {
      await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile]);
    } finally {
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
    }
    const videoUrl = `/api/uploads/videos/${path.basename(outFile)}`;

    // 入视频库: 一条 kind=long、segment=0 的总成片(绑定该剧本)
    const taskId = `merged-${sid}-${stamp}`;
    const now = new Date().toISOString();
    const first = queryAll(db, `SELECT model_key, model, resolution, ratio FROM ${TABLE} WHERE script_id=? AND kind='long' AND segment>0 ORDER BY segment ASC LIMIT 1`, [sid])[0] || {};
    db.run(
      `INSERT INTO ${TABLE}(id,provider,model_key,model,script_name,kind,segment,script_id,prompt,image_url,status,video_url,error,resolution,ratio,duration,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        taskId, "doubao", String(first.model_key || ""), String(first.model || ""), scriptName,
        "long", 0, sid,
        `《${scriptName}》拼接成片(${files.length} 段)`, "", "succeeded", videoUrl, "",
        String(first.resolution || ""), String(first.ratio || ""), "", now, now,
      ],
    );
    await persist();

    console.log(`[merge] 剧本${sid} 拼接 ${files.length} 段 -> ${videoUrl}`);
    return Response.json({ ok: true, taskId, videoUrl, segments: files.length, detail: `已拼接 ${files.length} 段并入视频库` });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
