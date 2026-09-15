"use client";

import { Button } from "antd";
import { ReloadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import ChatModule from "./components/ChatModule";

export default function Home() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f7f7f7" }}>
      {/* head: logo 栏 */}
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 20px", background: "#fff",
          borderBottom: "1px solid #e5e5e5", flexShrink: 0,
        }}
      >
        <VideoCameraOutlined style={{ fontSize: 22, color: "#000" }} />
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>AI视频工坊</span>
        <span style={{ fontSize: 12, color: "#999" }}>AI Video Studio</span>
        <div style={{ flex: 1 }} />
        <Button
          shape="default"
          icon={<ReloadOutlined />}
          onClick={() => window.location.reload()}
          title="刷新页面"
        />
      </header>

      {/* body: 模块从左到右排列, 自动填充剩余高度(无 tail) */}
      <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", gap: 16, alignItems: "stretch" }}>
        <ChatModule />
        {/* 后续模块在此从左到右追加 */}
      </div>
    </div>
  );
}