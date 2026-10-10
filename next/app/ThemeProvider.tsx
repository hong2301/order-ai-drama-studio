"use client";

// 主题(深浅色)管理: html[data-theme] 驱动 CSS 变量 + antd darkAlgorithm
// 业务组件通过 useThemeMode() 读/切换(顶栏的「浅色/深色」按钮)
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createContext, useContext, useEffect, useState } from "react";

type Mode = "light" | "dark";

const ThemeModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({
  mode: "light",
  setMode: () => { /* 由 Provider 注入 */ },
});

/** 读取/切换深浅色(必须在 ThemeProvider 内使用) */
export function useThemeMode(): { mode: Mode; setMode: (m: Mode) => void } {
  return useContext(ThemeModeContext);
}

/**
 * 主题 token。
 * ⚠ 不要在这里写 colorBgContainer / colorText / colorBorder / colorBgLayout 这类颜色 ——
 *   显式 token 会覆盖 algorithm(darkAlgorithm), 导致表格/弹窗/卡片仍是白的。
 *   颜色一律交给算法决定, 这里只放与明暗无关的(圆角/字号) + 分模式的主色/组件定制。
 */
const radiusToken = { borderRadius: 10 };

/** 浅色: 主色黑; Segmented 选中=黑底白字 */
const lightTheme = {
  token: { ...radiusToken, colorPrimary: "#000000", colorInfo: "#000000" },
  components: {
    Segmented: {
      trackBg: "#f2f2f2",
      itemColor: "#666666",
      itemHoverColor: "#111111",
      itemSelectedBg: "#111111",
      itemSelectedColor: "#ffffff",
    },
  },
};

/**
 * 深色: 主色仍用**深色系**(不是反转为白) —— 用比背景亮一档的深灰当主色,
 * 与整体黑白灰层次一致(背景 #0f0f0f → 卡片 #1a1a1a → 主按钮/选中 #333333)。
 * colorTextLightSolid 显式给白: 否则深色算法会按“主色是亮色”给黑字, 在深灰按钮上看不见。
 */
const darkTheme = {
  token: {
    ...radiusToken,
    colorPrimary: "#333333",
    colorInfo: "#333333",
    colorTextLightSolid: "#ffffff",
  },
  components: {
    Segmented: {
      itemSelectedBg: "#3a3a3a",
      itemSelectedColor: "#ffffff",
    },
  },
};

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  // 首次挂载后读本地偏好(不在渲染期读 localStorage, 避免 SSR 不一致)
  useEffect(() => {
    const saved = localStorage.getItem("theme-mode");
    if (saved === "dark" || saved === "light") setMode(saved);
  }, []);

  // 应用主题: CSS 变量由 html[data-theme] 驱动; antd 走 darkAlgorithm
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("theme-mode", mode);
  }, [mode]);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          ...(mode === "dark" ? darkTheme : lightTheme),
          algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}
