"use client";

import { useEffect, useState } from "react";
import { Button, Segmented } from "antd";
import { useThemeMode } from "./ThemeProvider";
import { ReloadOutlined } from "@ant-design/icons";
import ChatModule from "./components/ChatModule";
import ScriptModule from "./components/ScriptModule";
import ConsoleModule from "./components/ConsoleModule";
import InfoCardModule from "./components/InfoCardModule";
import KeySettings from "./components/KeySettings";

export default function Home() {
  const [version, setVersion] = useState("");
  /** 剧本形态: 短剧本(现有工作台) / 长剧本(待建设) */
  const [mode, setMode] = useState<"short" | "long">("short");
  /** 深浅色(全局, 由 ThemeProvider 驱动) */
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();

  // 版本号(logo 栏标题右侧显示)
  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("读取失败"))))
      .then((j: { version?: string }) => setVersion(j.version || ""))
      .catch(() => { /* 静默 */ });
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-page)" }}>
      {/* head: logo 栏 */}
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 20px", background: "var(--bg-card)",
          borderBottom: "1px solid var(--border-1)", flexShrink: 0,
        }}
      >
        <img src="/icon.svg" alt="logo" style={{ width: 30, height: 30, borderRadius: 6 }} />
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>AI视频工坊</span>
        {version && <span style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3 }}>v{version}</span>}
        <div style={{ flex: 1 }} />
        {/* 剧本形态切换: 短剧本(现有工作台) / 长剧本(待建设); 位于刷新按钮左侧
            不设 size → 用 antd 默认尺寸(controlHeight=32), 与右侧刷新按钮等高 */}
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as "short" | "long")}
          options={[
            { label: "短剧本", value: "short" },
            { label: "长剧本", value: "long" },
          ]}
        />
        {/* 刷新按钮, API Key 设置在其右边 */}
        {/* 深浅色切换(位于刷新按钮左侧) */}
        <Segmented
          value={themeMode}
          onChange={(v) => setThemeMode(v as "light" | "dark")}
          options={[
            { label: "浅色", value: "light" },
            { label: "深色", value: "dark" },
          ]}
        />
        <Button
          shape="default"
          icon={<ReloadOutlined />}
          onClick={() => window.location.reload()}
          title="刷新页面"
        />
        <KeySettings />
      </header>

      {/* body: 模块从左到右排列, 自动填充剩余高度(无 tail) */}
      {/* body: 短剧本(现有三列工作台) / 长剧本(三列, 左列剧本库, 其余待建设) */}
      {mode === "long" ? (
        <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", gap: 16, alignItems: "stretch", overflowX: "auto" }}>
          {/* 左列: 长剧本库(kind=long, 与短剧本数据隔离) */}
          <div style={{ flex: 1, minWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
            <ScriptModule kind="long" />
          </div>
          {/* 中列 / 右列: 待建设 */}
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                flex: 1, minWidth: 420, display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px dashed var(--border-4)", borderRadius: 12,
                color: "var(--text-5)", fontSize: 13, letterSpacing: 1,
              }}
            >
              待建设
            </div>
          ))}
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", gap: 16, alignItems: "stretch", overflowX: "auto" }}>
        <ChatModule />
        {/* 剧本(上, 6) + 控制台(下, 4) 同列: 弹性宽度(窗口拉大跟着变宽), 保底 420 */}
        <div style={{ flex: 1, minWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ flex: 6, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ScriptModule />
          </div>
          <div style={{ flex: 4, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ConsoleModule />
          </div>
        </div>
        {/* 人物/场景/产品: 三个资料库上中下排成一列(共用图片表), flex 撑满列高 */}
        <div style={{ flex: 1, minWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          <InfoCardModule title="人物库" api="/api/characters" identityLabel="身份" identityPlaceholder="输入身份后回车, 如 主角/婆婆/邻居" />
          <InfoCardModule title="场景库" api="/api/scenes" identityLabel="类型" identityPlaceholder="" showIdentity={false} />
          <InfoCardModule title="产品库" api="/api/products" identityLabel="品类" identityPlaceholder="" showIdentity={false} />
        </div>
        {/* 后续模块在此从左到右追加 */}
      </div>
      )}
    </div>
  );
}