"use client";

import { Button } from "antd";
import { ReloadOutlined, VideoCameraOutlined } from "@ant-design/icons";
import ChatModule from "./components/ChatModule";
import ScriptModule from "./components/ScriptModule";
import InfoCardModule from "./components/InfoCardModule";

export default function Home() {
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
        <VideoCameraOutlined style={{ fontSize: 22, color: "#000" }} />
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>AI视频工坊</span>
        <div style={{ flex: 1 }} />
        <Button
          shape="default"
          icon={<ReloadOutlined />}
          onClick={() => window.location.reload()}
          title="刷新页面"
        />
      </header>

      {/* body: 模块从左到右排列, 自动填充剩余高度(无 tail) */}
      <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", gap: 16, alignItems: "stretch" }}>
        <ChatModule />
        <ScriptModule />
        {/* 人物/场景/产品: 三个资料库上中下排成一列(共用图片表) */}
        <div style={{ width: 460, display: "flex", flexDirection: "column", gap: 12 }}>
          <InfoCardModule title="人物库" api="/api/characters" identityLabel="身份" identityPlaceholder="输入身份后回车, 如 主角/婆婆/邻居" />
          <InfoCardModule title="场景库" api="/api/scenes" identityLabel="类型" identityPlaceholder="输入场景类型后回车, 如 客厅/医院/街头" />
          <InfoCardModule title="产品库" api="/api/products" identityLabel="品类" identityPlaceholder="输入品类/卖点后回车, 如 保健品/礼盒" />
        </div>
        {/* 后续模块在此从左到右追加 */}
      </div>
    </div>
  );
}