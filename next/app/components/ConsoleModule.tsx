"use client";

import { useState, useEffect } from "react";
import { App as AntApp, Button, InputNumber, Segmented, Space } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";

/** 控制台模块: 视频生成基础参数(分辨率/比例/时长) + 底部工具栏(开始生成) */
export default function ConsoleModule() {
  const { message } = AntApp.useApp();
  const [resolution, setResolution] = useState<string>("1080P");
  const [ratio, setRatio] = useState<string>("9:16");
  const [duration, setDuration] = useState<number>(15);

  // 剧本联动: 选中剧本时同步其解析出的 分辨率/比例/时长(没有的保留默认)
  useEffect(() => {
    const onLink = (e: Event): void => {
      const d = (e as CustomEvent).detail as { resolution?: string; duration?: string; ratio?: string };
      if (d.resolution) setResolution(d.resolution);
      if (d.ratio) setRatio(d.ratio);
      if (d.duration) setDuration(Number(d.duration) || 15);
    };
    window.addEventListener("library-link", onLink);
    return () => window.removeEventListener("library-link", onLink);
  }, []);

  const start = (): void => {
    // TODO: 接入视频生成流程后在此触发
    message.info(`开始生成: ${ratio} ${resolution} · ${duration}秒`);
  };

  // 参数行公共样式
  const rowWrap: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#222", flexShrink: 0, whiteSpace: "nowrap", width: 64 };

  return (
    <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", borderRadius: 12, border: "3px solid #111", background: "#fff", overflow: "hidden" }}>
      {/* 参数区(无标题) */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={rowWrap}>
          <span style={labelStyle}>分辨率</span>
          <Segmented size="small" value={resolution} onChange={(v) => setResolution(String(v))} options={["480P", "720P", "1080P"]} />
        </div>

        <div style={rowWrap}>
          <span style={labelStyle}>画面比例</span>
          <Segmented
            size="small"
            value={ratio}
            onChange={(v) => setRatio(String(v))}
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
              max={120}
              value={duration}
              onChange={(v) => setDuration(Number(v) || 1)}
              style={{ width: 96 }}
            />
            <div style={{ padding: "0 10px", background: "#f5f5f5", borderLeft: "1px solid #eee", display: "flex", alignItems: "center", fontSize: 12, color: "#666" }}>秒</div>
          </Space.Compact>
        </div>
      </div>

      {/* 底部工具栏: 开始生成 */}
      <div style={{ borderTop: "1px solid #eee", padding: 10, display: "flex", justifyContent: "flex-end" }}>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={start} style={{ height: 40, display: "inline-flex", alignItems: "center" }}>
          开始生成
        </Button>
      </div>
    </div>
  );
}