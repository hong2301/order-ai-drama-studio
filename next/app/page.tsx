"use client";

import { useEffect, useState } from "react";
import { Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import ChatModule from "./components/ChatModule";
import ScriptModule from "./components/ScriptModule";
import ConsoleModule from "./components/ConsoleModule";
import InfoCardModule from "./components/InfoCardModule";
import KeySettings from "./components/KeySettings";

export default function Home() {
  const [version, setVersion] = useState("");

  // 版本号(logo 栏标题右侧显示)
  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("读取失败"))))
      .then((j: { version?: string }) => setVersion(j.version || ""))
      .catch(() => { /* 静默 */ });
  }, []);

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
        <img src="/icon.svg" alt="logo" style={{ width: 30, height: 30, borderRadius: 6 }} />
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>AI视频工坊</span>
        {version && <span style={{ fontSize: 11, color: "#999", marginTop: 3 }}>v{version}</span>}
        <div style={{ flex: 1 }} />
        {/* 刷新按钮, API Key 设置在其右边 */}
        <Button
          shape="default"
          icon={<ReloadOutlined />}
          onClick={() => window.location.reload()}
          title="刷新页面"
        />
        <KeySettings />
      </header>

      {/* body: 模块从左到右排列, 自动填充剩余高度(无 tail) */}
      <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", gap: 16, alignItems: "stretch" }}>
        <ChatModule />
        {/* 剧本(上, 6) + 控制台(下, 4) 同列 */}
        <div style={{ width: 460, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ flex: 6, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ScriptModule />
          </div>
          <div style={{ flex: 4, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ConsoleModule />
          </div>
        </div>
        {/* 人物/场景/产品: 三个资料库上中下排成一列(共用图片表), flex 撑满列高 */}
        <div style={{ width: 460, display: "flex", flexDirection: "column", gap: 12 }}>
          <InfoCardModule title="人物库" api="/api/characters" identityLabel="身份" identityPlaceholder="输入身份后回车, 如 主角/婆婆/邻居" />
          <InfoCardModule title="场景库" api="/api/scenes" identityLabel="类型" identityPlaceholder="" showIdentity={false} />
          <InfoCardModule title="产品库" api="/api/products" identityLabel="品类" identityPlaceholder="" showIdentity={false} />
        </div>
        {/* 后续模块在此从左到右追加 */}
      </div>
    </div>
  );
}