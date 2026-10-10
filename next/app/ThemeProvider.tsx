"use client";

// 全局偏好: 深浅色 + 剧本形态(短/长)
// 值存 cookie(不是 localStorage) —— 服务端 layout 能读到, 首帧就渲染成正确主题,
// 既没有"先浅后深"的闪烁, 也不会 hydration mismatch。
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";
export type ScriptMode = "short" | "long";

interface Prefs {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  scriptMode: ScriptMode;
  setScriptMode: (m: ScriptMode) => void;
}

const PrefsContext = createContext<Prefs>({
  themeMode: "light",
  setThemeMode: () => { /* Provider 注入 */ },
  scriptMode: "short",
  setScriptMode: () => { /* Provider 注入 */ },
});

/** 读全局偏好(必须在 ThemeProvider 内使用) */
export function usePrefs(): Prefs {
  return useContext(PrefsContext);
}

/** 写 cookie(一年有效, 整站路径) */
function setCookie(key: string, value: string): void {
  try { document.cookie = `${key}=${value}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* ignore */ }
}

/**
 * 主题 token。
 * ⚠ 不要在这里写 colorBgContainer / colorText / colorBorder 这类颜色 ——
 *   显式 token 会覆盖 algorithm(darkAlgorithm), 导致表格/弹窗/卡片仍是白的。
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
 * 深色: 主色仍用**深色系**(不是反转为白) —— 比背景亮一档的深灰,
 * 与整体层次一致(背景 #0f0f0f → 卡片 #1a1a1a → 主按钮/选中 #333333)。
 * colorTextLightSolid 显式给白: 否则深色算法按"主色是亮色"给黑字, 深灰按钮上看不见。
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

export default function ThemeProvider({
  children,
  initialTheme = "light",
  initialScriptMode = "short",
}: {
  children: React.ReactNode;
  /** 由服务端 layout 从 cookie 读出并传入 —— 保证首帧与服务端一致 */
  initialTheme?: ThemeMode;
  initialScriptMode?: ScriptMode;
}) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialTheme);
  const [scriptMode, setScriptModeState] = useState<ScriptMode>(initialScriptMode);

  const setThemeMode = (m: ThemeMode): void => {
    setThemeModeState(m);
    setCookie("theme-mode", m);
    document.documentElement.setAttribute("data-theme", m);
  };

  const setScriptMode = (m: ScriptMode): void => {
    setScriptModeState(m);
    setCookie("script-mode", m);
  };

  // 首帧同步一次 html[data-theme](服务端已写在 html 上, 这里兜底)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  return (
    <PrefsContext.Provider value={{ themeMode, setThemeMode, scriptMode, setScriptMode }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          ...(themeMode === "dark" ? darkTheme : lightTheme),
          algorithm: themeMode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </PrefsContext.Provider>
  );
}
