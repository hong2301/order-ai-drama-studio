// 视频模型列表: GET /api/video/models?fresh=1(强制重新探测)
// 自动检测: 对每个注册表模型发 duration=999 探测(不生成不扣费) → 未开通(inactive)/可用(active)/未知
// 结果缓存 24h(model_probe_video.json); 探测失败时回退注册表静态标注
import type { NextRequest } from "next/server";
import { listModelDefs } from "@/lib/server/video";
import type { VideoModelDef } from "@/lib/server/video/types";
import { probeVideoModels } from "@/lib/server/video/probeVideo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const defs = listModelDefs();
  const needProbe = defs.some((m) => m.status === "active" || m.status === "inactive");

  let probes: Record<string, string> = {};
  if (needProbe) {
    try {
      const { items } = await probeVideoModels(fresh);
      probes = Object.fromEntries(items.map((i) => [i.key, i.status]));
    } catch { /* 探测失败 → 沿用注册表状态(不阻塞列表) */ }
  }

  const models: VideoModelDef[] = [...defs].sort((a, b) => (a.pricePerSecond ?? 99) - (b.pricePerSecond ?? 99)).map((m) => {
    const p = probes[m.key];
    if (!p || p === "unknown") return m; // 未知/未探测到 → 保留注册表标注
    // 用真实探测结果覆盖状态(未开通 → inactive + 提示; 可用 → active)
    const note = (m.note || "") + (p === "inactive" ? (m.note ? " · " : "") + "账号未开通" : "");
    return { ...m, status: p === "active" ? "active" : "inactive", note };
  });

  return Response.json({ ok: true, models, probed: needProbe ? !fresh : false, fresh });
}