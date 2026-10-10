import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// ---------- 加载项目根 .env(全项目唯一环境变量文件) ----------
const rootEnvPath = path.join(__dirname, "..", ".env");
try {
  if (fs.existsSync(rootEnvPath)) {
    for (const line of fs.readFileSync(rootEnvPath, "utf-8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && m[1] !== "NODE_ENV" && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch { /* ignore */ }

// ---------- dev 数据库目录: 项目根 data/(正式版由 Electron 显式注入 DRAMA_DATA_DIR=exe同级data) ----------
if (!process.env.DRAMA_DATA_DIR) {
  process.env.DRAMA_DATA_DIR = path.join(__dirname, "..", "data");
}

const nextConfig: NextConfig = {
  // standalone: 自带独立 Node 服务器(Electron 主进程直接跑, 用户无需装 Node)
  output: "standalone",
  images: { unoptimized: true },
  // Electron 壳经 127.0.0.1 访问 dev 资源(热更新), 允许跨域
  allowedDevOrigins: ["127.0.0.1"],
  // sql.js(WASM) 与 ffmpeg-static(自带 ffmpeg 二进制) 都交给 Node 运行时从 node_modules 直接加载:
  // 它们靠 __dirname 定位自己的二进制文件, 一旦被 webpack 打包, __dirname 会变成 .next/... 就找不到了
  serverExternalPackages: ["sql.js", "ffmpeg-static"],
};

export default nextConfig;