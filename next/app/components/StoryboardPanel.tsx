"use client";

// 详细分镜面板: 展示当前选中剧本的分镜, 并承载长剧本的分段生成状态
//   时间段 | 时长(可调) | 提示词(点击可改) | 媒体形式(可选) | 成品(段成片,可播放) | 备注(可改)
// 状态色: 处理中=黄 / 完成=默认(不额外着色) / 失败=红; 右键可「重新处理」该段
import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Empty, Input, InputNumber, Modal, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";

interface Shot {
  id: number;
  script_id: number;
  seq: number;
  time_range: string;
  duration: number;
  prompt: string;
  media_type: string;
  media_url: string;
  note: string;
  segment: number;
  status: string;
  video_url: string;
  error: string;
}

const MEDIA_OPTIONS = [
  { value: "video", label: "视频" },
  { value: "image", label: "图片" },
];

/** 行底色: 待处理(处理中)黄 / 处理成功绿 / 处理失败红; idle(未提交)不着色 */
const STATUS_BG: Record<string, string | undefined> = {
  running: "rgba(250, 173, 20, 0.16)",     // 黄
  succeeded: "rgba(82, 196, 26, 0.14)",   // 绿
  failed: "rgba(255, 77, 79, 0.16)",      // 红
};
const STATUS_TEXT: Record<string, string> = {
  idle: "未生成",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
};

export default function StoryboardPanel(): React.JSX.Element {
  const { message } = AntApp.useApp();
  const [scriptId, setScriptId] = useState<number | null>(null);
  const [scriptName, setScriptName] = useState("");
  const [items, setItems] = useState<Shot[]>([]);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; seg: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);            // 正在看的成片
  const [editPrompt, setEditPrompt] = useState<{ open: boolean; id: number; value: string }>({ open: false, id: 0, value: "" });
  const [modelKey, setModelKey] = useState("");                          // 重新处理时用的模型

  // 可用模型(与视频库同一份探测结果: 只取 active)
  useEffect(() => {
    fetch("/api/video/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("模型加载失败"))))
      .then((j: { models?: { key: string; status: string }[] }) => {
        const list = (j.models || []).filter((m) => m.status === "active");
        if (list.length) setModelKey(list[0].key);
      })
      .catch(() => { /* 静默 */ });
  }, []);

  // 剧本选中联动(与三库/控制台共用 library-link)
  useEffect(() => {
    const onLink = (e: Event): void => {
      const d = (e as CustomEvent).detail as { scriptId?: number | null; name?: string; unlink?: boolean };
      if (d.unlink || !d.scriptId) {
        setScriptId(null);
        setScriptName("");
        setItems([]);
        return;
      }
      setScriptId(Number(d.scriptId));
      setScriptName(String(d.name || ""));
    };
    window.addEventListener("library-link", onLink);
    return () => window.removeEventListener("library-link", onLink);
  }, []);

  const load = useCallback((sid: number, silent = false): void => {
    if (!silent) setLoading(true);
    fetch(`/api/scripts/${sid}/storyboards`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载分镜失败"))))
      .then((j: { items?: Shot[] }) => setItems(j.items || []))
      .catch((e: Error) => { if (!silent) message.error(e.message); })
      .finally(() => { if (!silent) setLoading(false); });
  }, [message]);

  useEffect(() => {
    if (scriptId) load(scriptId);
  }, [scriptId, load]);

  // 解析完成 / 剧本改动 / 控制台提交了生成 → 重新拉取
  useEffect(() => {
    const onChanged = (): void => { if (scriptId) load(scriptId, true); };
    window.addEventListener("scripts-changed", onChanged);
    window.addEventListener("storyboards-changed", onChanged);
    return () => {
      window.removeEventListener("scripts-changed", onChanged);
      window.removeEventListener("storyboards-changed", onChanged);
    };
  }, [scriptId, load]);

  // 生成中: 每 5 秒静默刷新一次(等后端轮询把状态回写到分镜)
  useEffect(() => {
    if (!scriptId) return;
    if (!items.some((x) => x.status === "running")) return;
    const iv = setInterval(() => load(scriptId, true), 5000);
    return () => clearInterval(iv);
  }, [scriptId, items, load]);

  /** 通用字段保存(本地立即更新 + 落库) */
  const saveField = useCallback(async (id: number, patch: Record<string, unknown>): Promise<void> => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const r = await fetch(`/api/storyboards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("保存失败");
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [message]);

  /** 右键「再生成」: 重跑该分镜所在的段; 若还没分段(未提交过)则触发一次全量分段生成
   *  结果只反映在列表底色上, 不弹顶部消息 */
  const redoSegment = useCallback(async (seg: number): Promise<void> => {
    setMenu(null);
    if (!scriptId || !modelKey) return;
    if (seg > 0) {
      setItems((prev) => prev.map((x) => (x.segment === seg ? { ...x, status: "running", error: "" } : x)));
    } else {
      setItems((prev) => prev.map((x) => ({ ...x, status: "running", error: "" })));
    }
    try {
      const r = await fetch(`/api/scripts/${scriptId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // seg=0(未分段) → 不传 segment, 后端全量分段提交
        body: JSON.stringify(seg > 0 ? { modelKey, segment: seg } : { modelKey }),
      });
      const j = (await r.json()) as { ok?: boolean; detail?: string };
      if (!r.ok || !j.ok) throw new Error(j.detail || "重新生成失败");
    } catch (e) {
      // 失败直接落到行上(红底 + 错误摘要), 不弹消息
      if (seg > 0) {
        setItems((prev) => prev.map((x) => (x.segment === seg ? { ...x, status: "failed", error: (e as Error).message } : x)));
      } else {
        setItems((prev) => prev.map((x) => ({ ...x, status: "failed", error: (e as Error).message })));
      }
    }
  }, [scriptId, modelKey]);

  const columns: ColumnsType<Shot> = [
    {
      title: "时间段", dataIndex: "time_range", width: 76,
      render: (v: string, r) => (
        <span style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>{v || `第${r.seq}段`}</span>
      ),
    },
    {
      title: "时长", dataIndex: "duration", width: 96,
      render: (v: number, r) => (
        <Space.Compact size="small">
          <InputNumber
            min={1} max={60} value={v || 0}
            onChange={(val) => void saveField(r.id, { duration: Math.max(1, Math.round(Number(val) || 1)) })}
            style={{ width: 52 }}
          />
          <span style={{ display: "inline-flex", alignItems: "center", padding: "0 5px", fontSize: 11, color: "var(--text-4)", background: "var(--bg-track)", border: "1px solid var(--border-1)", borderLeft: "none", borderRadius: "0 6px 6px 0" }}>秒</span>
        </Space.Compact>
      ),
    },
    {
      // 提示词: 点击弹窗编辑(内容长, 不适合行内改)
      title: "提示词", dataIndex: "prompt",
      render: (v: string, r) => (
        <div
          onClick={() => setEditPrompt({ open: true, id: r.id, value: v || "" })}
          title="点击编辑提示词"
          style={{ fontSize: 12, lineHeight: 1.65, color: "var(--text-1)", whiteSpace: "pre-wrap", cursor: "text" }}
        >
          {v}
        </div>
      ),
    },
    {
      // 媒体形式: 该段用图片还是视频(解析时已判定, 这里可改)
      title: "媒体", dataIndex: "media_type", width: 78,
      render: (v: string, r) => (
        <Select
          size="small"
          value={v || "video"}
          options={MEDIA_OPTIONS}
          onChange={(nv) => void saveField(r.id, { media_type: nv })}
          style={{ width: 68 }}
        />
      ),
    },
    {
      // 成品: 段成片。一段只出一个视频 → 同段只在首行显示封面(点击播放), 其余标注来源
      title: "成品", dataIndex: "video_url", width: 96,
      render: (_v: string, r) => {
        if (r.status !== "succeeded" || !r.video_url) {
          return (
            <span style={{ fontSize: 12, color: r.status === "failed" ? "#ff4d4f" : "var(--text-4)" }} title={r.error || ""}>
              {STATUS_TEXT[r.status] || r.status}
            </span>
          );
        }
        // 该段的第一行(按 seq 首次出现)
        const segRows = items.filter((x) => x.segment === r.segment);
        if (segRows.length > 1 && segRows[0].id !== r.id) {
          return <span style={{ fontSize: 11, color: "var(--text-5)" }}>↑ 同第 {r.segment} 段</span>;
        }
        return (
          <div
            onClick={(e) => { e.stopPropagation(); setPlaying(r.video_url); }}
            title="点击播放该段成片"
            style={{
              width: 74, height: 42, borderRadius: 6, overflow: "hidden", cursor: "pointer",
              border: "1px solid var(--border-2)", background: "#000", position: "relative",
            }}
          >
            {/* 封面: 视频首帧(#t=0.5 让浏览器直接渲染画面) */}
            <video
              src={`${r.video_url}#t=0.5`}
              preload="metadata"
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        );
      },
    },
    {
      // 备注: 行内直接改
      title: "备注", dataIndex: "note", width: 132,
      render: (v: string, r) => (
        <Input
          size="small"
          defaultValue={v}
          placeholder="点击添加"
          onBlur={(e) => { const nv = e.target.value.trim(); if (nv !== v) void saveField(r.id, { note: nv }); }}
          style={{ fontSize: 12 }}
        />
      ),
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid var(--border-1)", background: "var(--bg-card)", overflow: "hidden" }}>
      {/* 头部: 标题 + 当前剧本名 + 段数 */}
      <div style={{ flexShrink: 0, padding: "9px 12px", borderBottom: "1px solid var(--border-3)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", flexShrink: 0 }}>详细分镜</span>
        {scriptName && (
          <span style={{ fontSize: 12, color: "var(--text-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scriptName}</span>
        )}
        {items.length > 0 && <span style={{ fontSize: 12, color: "var(--text-5)", flexShrink: 0 }}>共 {items.length} 段</span>}
      </div>

      {/* 内容: 未选中剧本 → 提示; 选中 → 分镜表 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8, position: "relative" }}>
        {!scriptId ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-5)", fontSize: 13 }}>
            请选中一个剧本以编辑分镜
          </div>
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={items}
            pagination={false}
            onRow={(rec) => ({
              style: { background: STATUS_BG[rec.status] },
              onContextMenu: (e) => {
                e.preventDefault();
                // 每个分镜行都可右键; segment=0 表示还没提交过 → 菜单项不做段号区分, 点它走全量分段生成
                setMenu({ x: e.clientX, y: e.clientY, seg: rec.segment });
              },
            })}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ fontSize: 12, color: "var(--text-5)" }}>还没有分镜，右键剧本「解析」即可生成</span>}
                />
              ),
            }}
          />
        )}

        {/* 行右键菜单: 重新处理该段 */}
        {menu && (
          <>
            <div
              onClick={() => setMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
              style={{ position: "fixed", inset: 0, zIndex: 30 }}
            />
            <div style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 31, minWidth: 124, background: "var(--bg-card)", border: "1px solid var(--border-2)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden" }}>
              <div
                className="conv-menu-item"
                onClick={() => void redoSegment(menu.seg)}
                style={{ padding: "8px 14px", fontSize: 13, color: "var(--text-1)", cursor: "pointer" }}
              >
                再生成
              </div>
            </div>
          </>
        )}
      </div>

      {/* 提示词编辑弹窗 */}
      <Modal
        open={editPrompt.open}
        title="编辑提示词"
        width={560}
        destroyOnHidden
        onCancel={() => setEditPrompt((p) => ({ ...p, open: false }))}
        onOk={() => { void saveField(editPrompt.id, { prompt: editPrompt.value }); setEditPrompt((p) => ({ ...p, open: false })); }}
        okText="保存"
        cancelText="取消"
      >
        <Input.TextArea
          value={editPrompt.value}
          onChange={(e) => setEditPrompt((p) => ({ ...p, value: e.target.value }))}
          autoSize={{ minRows: 6, maxRows: 14 }}
          placeholder="该段的画面提示词…"
          style={{ fontSize: 13, lineHeight: 1.7 }}
        />
      </Modal>

      {/* 成片播放 */}
      <Modal open={!!playing} onCancel={() => setPlaying(null)} footer={null} width={520} title="分镜成片" destroyOnHidden>
        {playing && <video src={playing} controls autoPlay style={{ width: "100%", borderRadius: 8, background: "#000" }} />}
      </Modal>
    </div>
  );
}
