"use client";

// 视频库弹窗: 生成完成的视频列表(封面卡片) + 点击播放(大播放器弹窗) + 右键删除
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, Empty, Modal, Spin } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";

interface VideoTask {
  id: string;
  provider: string;
  modelKey: string;
  model: string;
  scriptName?: string;
  prompt: string;
  status: string;
  videoUrl?: string | null;
  error?: string | null;
  createdAt: string;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

export default function VideoLibraryModal(props: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { open, onClose } = props;
  const { message } = AntApp.useApp();
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [player, setPlayer] = useState<VideoTask | null>(null); // 播放器弹窗
  const tasksRef = useRef<VideoTask[]>([]); // 最新列表(供自动刷新非终态任务用)

  const PAGE = 20;

  // 拉一页(完成的); append=true 追加, 否则覆盖
  const fetchPage = useCallback(async (offset: number, append: boolean): Promise<void> => {
    try {
      const r = await fetch(`/api/video/tasks?limit=${PAGE}&offset=${offset}`);
      const j = (await r.json()) as { ok?: boolean; tasks?: VideoTask[]; detail?: string };
      if (!j.ok) throw new Error(j.detail);
      const done = (j.tasks || []).filter((t) => t.status !== "failed" && t.status !== "cancelled");
      setHasMore(done.length >= PAGE);
      setTasks((prev) => (append ? [...prev, ...done] : done));
    } catch (e) {
      message.warning(`加载视频库失败: ${(e as Error).message}`);
    }
  }, [message]);

  // 首屏/刷新: 从第一页重新拉
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setHasMore(true);
    await fetchPage(0, false);
    setLoading(false);
  }, [fetchPage]);

  // 滚动到底部附近 → 加载下一页
  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    await fetchPage(tasks.length, true);
    setLoadingMore(false);
  }, [loadingMore, hasMore, loading, tasks.length, fetchPage]);

  useEffect(() => {
    if (!open) return;
    void reload();
    const onChanged = (): void => void reload();
    window.addEventListener("videos-changed", onChanged);
    return () => window.removeEventListener("videos-changed", onChanged);
  }, [open, reload]);

  // 记录最新列表(供自动"刷新生成中任务"使用, 避免闭包陈旧)
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // 打开后 1s: 把仍处于生成中(queued/running)的任务逐个问方舟拉真实状态,
  // 卡住的失败/超时任务会转终态 → 重拉列表后占位自动消失(安全清理)
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      const pend = tasksRef.current.filter((t) => t.status === "queued" || t.status === "running").slice(0, 6);
      if (!pend.length) return;
      void Promise.allSettled(pend.map((t) => fetch(`/api/video/tasks/${t.id}`))).then(() => {
        void reload();
      });
    }, 1000);
    return () => { if (timer) clearTimeout(timer); };
  }, [open, reload]);

  const delOne = async (id: string): Promise<void> => {
    setMenu(null);
    try {
      const r = await fetch(`/api/video/tasks/${id}`, { method: "DELETE" });
      const j = (await r.json()) as { ok?: boolean; detail?: string };
      if (!r.ok || !j.ok) throw new Error(j.detail || "删除失败");
      message.success("已删除");
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (player?.id === id) setPlayer(null);    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <>
      <Modal open={open} title="视频库" onCancel={onClose} footer={null} width={980} destroyOnHidden>
        <div
          style={{ minHeight: 320, maxHeight: "68vh", overflowY: "auto" }}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) void loadMore();
          }}
        >
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
              <Spin /> 加载中…
            </div>
          ) : tasks.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 13, color: "#bbb" }}>暂无生成完成的视频</span>} style={{ padding: "36px 0" }} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>              {tasks.map((t) => {
                const done = t.status === "succeeded" && t.videoUrl;
                return done ? (
                  <div
                    key={t.id}
                    onClick={() => setPlayer(t)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: t.id }); }}
                    style={{
                      border: "1px solid #eee", borderRadius: 12, overflow: "hidden", cursor: "pointer",
                      background: "#fff", transition: "box-shadow .2s", position: "relative",
                    }}
                  >
                    {/* 封面: video 预加载停在首帧(可大尺寸展示) */}
                    <div style={{ position: "relative", aspectRatio: "16/9", background: "#000" }}>
                      <video
                        src={t.videoUrl || undefined}
                        muted
                        playsInline
                        preload="metadata"
                        width="100%"
                        height="100%"
                        style={{ objectFit: "cover", display: "block" }}
                      />
                      <div
                        style={{
                          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                          background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 34, opacity: 0.9,
                        }}
                      >
                        <PlayCircleOutlined />
                      </div>
                    </div>
                    <div style={{ padding: "9px 11px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.scriptName || "未命名剧本"}
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>创建于 {fmtDate(t.createdAt)}</div>
                    </div>
                  </div>
                ) : (
                  // 生成中占位: 该位置视频正在生成(右键可直接删除; 卡住的任务打开视频库会自动刷新转终态)
                  <div
                    key={t.id}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: t.id }); }}
                    title="生成中… 右键可删除"
                    style={{
                      border: "1px dashed #d9d9d9", borderRadius: 12, overflow: "hidden",
                      background: "#fafafa", position: "relative", cursor: "context-menu",
                    }}
                  >
                    <div style={{ position: "relative", aspectRatio: "16/9", background: "#f0f0f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Spin />
                      <span style={{ fontSize: 12, color: "#999" }}>生成中…</span>
                    </div>
                    <div style={{ padding: "9px 11px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.scriptName || "未命名剧本"}
                      </div>
                      <div style={{ fontSize: 11, color: "#bbb", marginTop: 3 }}>创建于 {fmtDate(t.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* 滚动加载状态 */}
          {loadingMore && (
            <div style={{ textAlign: "center", padding: 14, fontSize: 12, color: "#999" }}>
              <Spin size="small" style={{ marginRight: 6 }} />加载中…
            </div>
          )}
          {!hasMore && tasks.length > 0 && !loadingMore && (
            <div style={{ textAlign: "center", padding: 14, fontSize: 12, color: "#ccc" }}>没有更多了</div>
          )}
        </div>
      </Modal>

      {/* 右键删除菜单 */}
      {menu && (
        <>
          <div onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 1200 }} />
          <div style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 1201, minWidth: 100, background: "#fff", border: "1px solid #eee", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden" }}>
            <div onClick={() => void delOne(menu.id)} style={{ padding: "8px 14px", fontSize: 13, color: "#ff4d4f", cursor: "pointer" }}>删除</div>
          </div>
        </>
      )}

      {/* 播放器弹窗(大尺寸, 不就地播放) */}
      <Modal
        open={!!player}
        title={player?.scriptName || "视频预览"}
        footer={null}
        onCancel={() => setPlayer(null)}
        width={900}
        destroyOnHidden
        style={{ top: 24 }}
      >
        {player && (
          <>
            <video src={player.videoUrl || undefined} controls autoPlay playsInline style={{ width: "100%", maxHeight: "70vh", borderRadius: 10, background: "#000", display: "block" }} />
            <div style={{ marginTop: 10, fontSize: 12, color: "#888", lineHeight: 1.6 }}>
              {player.prompt ? `提示词：${player.prompt}` : ""}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}