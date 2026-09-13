import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 将此项目目录作为 tracing 根，消除 package-lock 在 Git 仓库外的警告
  outputFileTracingRoot: path.join(__dirname, ".."),
  // 全栈模式: standalone 自带独立 Node 服务器(Electron 主进程直接跑, 用户无需装 Node)
  output: "standalone",
  // sql.js 含 .wasm, 交由 Node 运行时从 node_modules 直接加载(webpack 不参与, 避免 WASM parse 失败)
  serverExternalPackages: ["better-sqlite3"],
  images: { unoptimized: true },
  // dev 下允许 127.0.0.1 访问 HMR(playwright/局域网调试)
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;