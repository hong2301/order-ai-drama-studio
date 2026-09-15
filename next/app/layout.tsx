import type { Metadata, Viewport } from "next";
import { ConfigProvider } from "antd";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI视频工坊",
  description: "AI Video Studio — 豆包视频生成工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/** 整体主题: 黑白色(极简黑白灰) */
const blackWhiteTheme = {
  token: {
    colorPrimary: "#000000",
    colorInfo: "#000000",
    colorBgLayout: "#f7f7f7",
    colorBgContainer: "#ffffff",
    colorText: "#111111",
    colorTextSecondary: "#888888",
    colorBorder: "#e5e5e5",
    colorBorderSecondary: "#eeeeee",
    borderRadius: 10,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* AntdRegistry: SSR 时把 antd 样式注入 HTML 头部, 避免刷新时按钮无样式闪烁(FOUC) */}
        {/* locale=zh_CN: 日期选择器等组件文案中文化(开始日期/结束日期等占位符) */}
        <AntdRegistry>
          <ConfigProvider theme={blackWhiteTheme} locale={zhCN}>{children}</ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}