import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 偏好存 cookie: 服务端在这里就能读到, 首帧直接渲染正确主题/形态 —— 不闪、也不会有 hydration mismatch
  const jar = await cookies();
  const themeMode = jar.get("theme-mode")?.value === "dark" ? "dark" : "light";
  const scriptMode = jar.get("script-mode")?.value === "long" ? "long" : "short";

  return (
    <html lang="zh-CN" data-theme={themeMode} suppressHydrationWarning>
      <body>
        {/* AntdRegistry: SSR 时把 antd 样式注入 HTML 头部, 避免刷新时按钮无样式闪烁(FOUC) */}
        {/* ThemeProvider(客户端): 用服务端传来的初值套 antd 主题(浅色/深色算法), 并把切换写回 cookie */}
        <AntdRegistry>
          <ThemeProvider initialTheme={themeMode} initialScriptMode={scriptMode}>{children}</ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
