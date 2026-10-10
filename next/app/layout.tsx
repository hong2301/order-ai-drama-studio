import type { Metadata, Viewport } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import "antd/dist/reset.css";
import "./globals.css";
import ThemeProvider from "./ThemeProvider";

export const metadata: Metadata = {
  title: "AI视频工坊",
  description: "AI Video Studio — 豆包视频生成工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* AntdRegistry: SSR 时把 antd 样式注入 HTML 头部, 避免刷新时按钮无样式闪烁(FOUC) */}
        {/* ThemeProvider(客户端): 按本地偏好套 antd 主题(浅色/深色算法) + 设置 html[data-theme] 驱动 CSS 变量 */}
        <AntdRegistry>
          <ThemeProvider>{children}</ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
