"use client";

import { Typography } from "antd";

export default function Header() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 2px 14px", flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 20 }}>🎬</span>
      <Typography.Title level={4} style={{ margin: 0 }}>
        AI视频工坊
      </Typography.Title>
      <div style={{ flex: 1 }} />
    </div>
  );
}