"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, InputNumber, Segmented, Select, Space } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";

// ---------------- 类型 ----------------
interface VideoModelDef {
  key: string; provider: string; model: string; name: string;
  status: "active" | "retiring" | "inactive"; note?: string;
  pricePerSecond?: number;
  presets?: { resolutions?: string[]; ratios?: string[]; duration?: boolean; durationMax?: number };
}

const MODEL_STATUS_TXT: Record<string, string> = { active: "可用", retiring: "即将下线", inactive: "未开通" };

/** 时长输入框允许的最大秒数: 不按模型硬限(部分模型支持 15 秒以上), 超出模型上限由服务端自动下调并提示 */
const DURATION_INPUT_MAX = 60;

/** 视频控制台模块: 模型切换 + 生成参数(分辨率/比例/时长) + 开始生成 */
export default function ConsoleModule() {
  const { message } = AntApp.useApp();
  const [models, setModels] = useState<VideoModelDef[]>([]);
  const [modelKey, setModelKey] = useState<string>("");

  const [resolution, setResolution] = useState<string>("720P");
  const [ratio, setRatio] = useState<string>("9:16");
  const [duration, setDuration] = useState<number>(10);
  const [prompt, setPrompt] = useState<string>(""); // 来自剧本联动(选中剧本自动带入)

  const [generating, setGenerating] = useState(false);
  // 后台轮询: 提交后的任务生成完/失败时提示
  const pollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  // 反向联动: 当前联动剧本 id + 写回防抖
  const activeScriptRef = useRef<number | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 参数修改写回当前选中剧本(防抖 400ms; 未选中剧本时跳过) */
  const syncToScript = (patch: Record<string, unknown>): void => {
    const sid = activeScriptRef.current;
    if (!sid) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      fetch(`/api/scripts/${sid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .then((r) => r.json())
        .then((j) => { if (j.ok) window.dispatchEvent(new Event("scripts-changed")); })
        .catch(() => { /* 静默 */ });
    }, 400);
  };

  // 加载视频模型(仅显示可用的; 未开通/已下线的不展示)
  useEffect(() => {
    fetch("/api/video/models")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.detail);
        const list = (j.models as VideoModelDef[]).filter((m) => m.status !== "inactive");
        setModels(list);
        const first = list.find((m) => m.status === "active") || list[0];
        if (first) setModelKey(first.key);
      })
      .catch((e) => message.error(`加载模型失败: ${(e as Error).message}`));
  }, [message]);

  // 剧本联动: 选中剧本时同步 分辨率/比例/时长 + 提示词(剧本内容)
  useEffect(() => {
    const onLink = (e: Event): void => {
      const d = (e as CustomEvent).detail as { resolution?: string; duration?: string; ratio?: string; prompt?: string; unlink?: boolean; scriptId?: number | null };
      // 记录当前联动剧本(反向写回用)
      activeScriptRef.current = d.unlink ? null : (d.scriptId ?? null);
      // 取消剧本选中: 参数恢复默认
      if (d.unlink) {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        setResolution("720P");
        setRatio("9:16");
        setDuration(10);
        setPrompt("");
        return;
      }
      if (d.resolution) setResolution(d.resolution);
      if (d.ratio) setRatio(d.ratio);
      if (d.duration) setDuration(Number(d.duration) || 10);
      if (d.prompt) setPrompt(d.prompt);
    };
    window.addEventListener("library-link", onLink);
    return () => window.removeEventListener("library-link", onLink);
  }, []);

  /** 后台轮询任务直到终态: 成功/失败给消息, 成功触发视频库刷新 */
  const watchTask = useCallback((id: string): void => {
    if (pollRef.current[id]) return;
    pollRef.current[id] = setInterval(async () => {
      try {
        const r = await fetch(`/api/video/tasks/${id}`);
        const j = (await r.json()) as { ok?: boolean; task?: { status?: string; error?: string | null } };
        if (!j.ok || !j.task) throw new Error("任务不存在");
        const st = j.task.status;
        if (st === "succeeded") {
          const iv = pollRef.current[id];
          if (iv) { clearInterval(iv); delete pollRef.current[id]; }
          message.success("视频生成完成，已存入视频库");
          window.dispatchEvent(new Event("videos-changed"));
        } else if (st === "failed" || st === "cancelled") {
          const iv = pollRef.current[id];
          if (iv) { clearInterval(iv); delete pollRef.current[id]; }
          message.warning(`视频生成${st === "cancelled" ? "已取消" : "失败"}${j.task.error ? `：${j.task.error}` : ""}`);
        }
      } catch {
        const iv = pollRef.current[id];
        if (iv) { clearInterval(iv); delete pollRef.current[id]; }
      }
    }, 5000);
  }, [message]);

  const start = async (): Promise<void> => {
    const mk = modelKey || models[0]?.key;
    if (!mk) { message.error("未选择模型"); return; }
    if (!prompt.trim()) { message.warning("请先在剧本库选中一个剧本(生成内容自动带入)"); return; }
    setGenerating(true);
    try {
      const r = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelKey: mk,
          prompt: prompt.trim(),
          scriptId: activeScriptRef.current, // 一致性检查+剧情适配用
          resolution,
          ratio,
          duration,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; detail?: string; task?: { id?: string; status?: string; duration?: string; durationAdjustedFrom?: number } };
      if (!r.ok || !j.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      // 时长超出模型接口上限 → 已按接口返回的上限调整, 提示用户
      if (j.task?.durationAdjustedFrom) {
        message.warning(`该模型时长上限 ${j.task.duration || ""} 秒（接口返回），已自动调整（原设 ${j.task.durationAdjustedFrom} 秒）`);
      }
      message.success(`已提交生成任务，约 1-3 分钟完成`);
      watchTask(j.task?.id || ""); // 进后台轮询, 完成后给提示
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const rowWrap: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#222", flexShrink: 0, whiteSpace: "nowrap", width: 64 };

  return (
    <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", borderRadius: 12, border: "3px solid #111", background: "#fff", overflow: "hidden" }}>
      {/* 参数区 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={rowWrap}>
          <span style={labelStyle}>分辨率</span>
          <Segmented size="small" value={resolution} onChange={(v) => { setResolution(String(v)); syncToScript({ resolution: String(v) }); }} options={["480P", "720P", "1080P"]} />
        </div>

        <div style={rowWrap}>
          <span style={labelStyle}>画面比例</span>
          <Segmented
            size="small"
            value={ratio}
            onChange={(v) => { setRatio(String(v)); syncToScript({ ratio: String(v) }); }}
            options={[
              { label: "竖屏 9:16", value: "9:16" },
              { label: "横屏 16:9", value: "16:9" },
              { label: "方形 1:1", value: "1:1" },
            ]}
          />
        </div>

        <div style={rowWrap}>
          <span style={labelStyle}>时长</span>
          <Space.Compact size="small">
            <InputNumber
              min={1}
              max={DURATION_INPUT_MAX}
              value={duration}
              onChange={(v) => {
                // 不再按模型硬限 12 秒: 允许输入更长时长(部分模型支持 15 秒以上)
                // 超出模型上限时由服务端自动下调到上限并提示
                const n = Math.min(DURATION_INPUT_MAX, Math.max(1, Number(v) || 1));
                setDuration(n);
                syncToScript({ duration: n });
              }}
              style={{ width: 96 }}
            />
            <div style={{ padding: "0 10px", background: "#f5f5f5", borderLeft: "1px solid #eee", display: "flex", alignItems: "center", fontSize: 12, color: "#666" }}>
              秒
            </div>
          </Space.Compact>
        </div>
      </div>

      {/* 底部工具栏: 模型切换(左) + 开始生成(右) */}
      <div style={{ borderTop: "1px solid #eee", padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <Select
          size="large"
          value={modelKey || undefined}
          onChange={(v) => setModelKey(String(v))}
          placeholder="选择视频模型"
          style={{ width: 240 }}
          popupMatchSelectWidth={330}
          options={(models || []).map((m) => ({
            value: m.key,
            disabled: m.status === "retiring",
            label: (
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                <span style={{ flexShrink: 0, color: "#888", fontSize: 12 }}>¥{m.pricePerSecond}/秒</span>
              </span>
            ),
          }))}
        />
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void start()} loading={generating} style={{ height: 40, display: "inline-flex", alignItems: "center", minWidth: 120 }}>
          {generating ? "提交中…" : "开始生成"}
        </Button>
      </div>
    </div>
  );
}