"use client";

import { useMemo, useState } from "react";
import {
  Button, Card, Empty, Popconfirm, Space, Tag, Tooltip, Typography, message,
} from "antd";
import {
  CopyOutlined, DeleteOutlined, FolderOpenOutlined, ReloadOutlined, PlayCircleFilled,
} from "@ant-design/icons";
import { api, videoUrl } from "../lib/api";
import type { Generation, GenerationStatus } from "../lib/types";

const STATUS: Record<GenerationStatus, { color: string; text: string }> = {
  draft: { color: "default", text: "草稿" },
  queued: { color: "blue", text: "排队中" },
  running: { color: "processing", text: "生成中" },
  succeeded: { color: "green", text: "已生成" },
  downloaded: { color: "green", text: "已下载" },
  failed: { color: "red", text: "失败" },
};

interface Props {
  generations: Generation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void;
}

interface RevealResp { ok: boolean; msg?: string }

export default function ResultArea({ generations, selectedId, onSelect, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const selected = generations.find((g) => g.id === selectedId) || null;

  const remove = async (g: Generation) => {
    try {
      await api.del(`/api/generations/${g.id}`);
      if (selectedId === g.id) onSelect(0);
      onChanged();
    } catch (e) { message.error(String((e as Error).message)); }
  };
  const reveal = async (g: Generation) => {
    try {
      const r = await api.post<RevealResp>("/api/system/reveal", { path: g.local_path });
      if (!r.ok) message.warning(r.msg || "开发模式无打开文件夹能力");
    } catch { message.warning("无法打开文件夹(浏览器模式)"); }
  };
  const copyPath = async (g: Generation) => {
    try {
      await navigator.clipboard.writeText(g.local_path || "");
      message.success("路径已复制");
    } catch { message.warning("复制失败"); }
  };

  const statusSummary = useMemo(() => {
    const c = { queued: 0, running: 0, downloaded: 0, failed: 0 };
    for (const g of generations) if (g.status in c) (c as Record<string, number>)[g.status]++;
    return c;
  }, [generations]);

  return (
    <Card
      size="small" title="成品区" style={{ height: "100%", display: "flex", flexDirection: "column" }}
      extra={
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {generations.length ? `共${generations.length}条` : ""}
            {statusSummary.running || statusSummary.queued ? ` · 进行中${statusSummary.running + statusSummary.queued}` : ""}
            {statusSummary.downloaded ? ` · 完成${statusSummary.downloaded}` : ""}
          </Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={onChanged} />
        </Space>
      }
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        {/* 视频预览(竖屏) */}
        <div style={{ flex: 1, minHeight: 260, background: "#0b0e13", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {selected?.status === "downloaded" ? (
            <video
              key={selected.id} src={videoUrl(selected.id)} controls preload="metadata"
              style={{ height: "100%", maxHeight: "52vh", width: "auto" }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                selectedId
                  ? (() => {
                      const s = selected?.status;
                      if (s === "running" || s === "queued") return "生成中，请稍候…";
                      if (s === "failed") return `生成失败：${selected?.error || "未知错误"}`;
                      return "该记录暂无视频";
                    })()
                  : "选择左侧任务预览视频"
              }
            />
          )}
        </div>

        {/* 任务列表(纯 div, 避免 antd List 弃用警告) */}
        {generations.length === 0 ? (
          <Empty description="暂无生成记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {generations.map((g) => (
              <div
                key={g.id}
                onClick={() => onSelect(g.id)}
                style={{
                  padding: "6px 4px 6px 8px", cursor: "pointer", display: "flex", alignItems: "flex-start", width: "100%",
                  borderInlineStart: selectedId === g.id ? "3px solid #1677ff" : "3px solid transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={6} wrap>
                    <Tooltip title={g.title}>
                      <Typography.Text strong style={{ fontSize: 12 }}>#{g.id} {g.title || "未命名"}</Typography.Text>
                    </Tooltip>
                    <Tag color={STATUS[g.status].color} style={{ fontSize: 10, marginInlineEnd: 0 }}>
                      {STATUS[g.status].text}
                    </Tag>
                  </Space>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                    {g.duration}s · {g.ratio} · {g.resolution} · {g.model_id}
                    {g.extra?.characters?.length ? ` · ${g.extra.characters.join("/")}` : ""}
                  </div>
                  {g.status === "downloaded" && (
                    <Space size={0} style={{ marginTop: 2 }}>
                      <Button size="small" type="link" icon={<FolderOpenOutlined />} style={{ padding: 0 }} onClick={(e) => { e.stopPropagation(); reveal(g); }}>
                        打开位置
                      </Button>
                      <Button size="small" type="link" icon={<CopyOutlined />} style={{ padding: 0 }} onClick={(e) => { e.stopPropagation(); copyPath(g); }}>
                        复制路径
                      </Button>
                    </Space>
                  )}
                  {g.status === "failed" && (
                    <div style={{ fontSize: 11, color: "#cf1322", marginTop: 2 }}>{g.error}</div>
                  )}
                </div>
                <Popconfirm title="删除该记录及本地视频?" onConfirm={() => remove(g)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <PlayCircleFilled style={{ color: "#1677ff" }} />
        <span style={{ fontSize: 11, color: "#999" }}> 完成后自动出现在列表，点击可播放</span>
      </div>
    </Card>
  );
}