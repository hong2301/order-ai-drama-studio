"use client";

import { Badge, Typography } from "antd";

export default function Header({ healthy }: { healthy: boolean | null }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 4px 8px", flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 20 }}>🎬</span>
      <Typography.Title level={4} style={{ margin: 0 }}>
        AI短剧工坊
      </Typography.Title>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        《嘴硬家属》15秒家庭短剧 · 豆包 Seedance 文字生成视频
      </Typography.Text>
      <div style={{ flex: 1 }} />
      {healthy === null ? (
        <Badge status="processing" text="连接后端中…" />
      ) : healthy ? (
        <Badge status="success" text="后端已连接" />
      ) : (
        <Badge status="error" text="后端未连接" />
      )}
    </div>
  );
}