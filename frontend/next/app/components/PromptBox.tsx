"use client";

import { Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import { PlayCircleOutlined, SyncOutlined } from "@ant-design/icons";
import type { Mode } from "./ControlPanel";

interface Props {
  mode: Mode;
  prompt: string;        // 当前展示的提示词(结构化预览/自由输入)
  dirty: boolean;        // 用户是否手动改过(改过则提交时用此文本)
  loading: boolean;      // 预览请求中
  generating: boolean;
  onPromptEdit: (t: string) => void;
  onGenerate: () => void;
}

export default function PromptBox({ mode, prompt, dirty, loading, generating, onPromptEdit, onGenerate }: Props) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8,
        flex: 1, minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Typography.Text strong>视频提示词</Typography.Text>
        {mode === "structured" ? (
          dirty ? (
            <Tag color="orange" style={{ fontSize: 11 }}>已手动改写（以你的内容为准）</Tag>
          ) : (
            <Tooltip title="由下方剧本配置自动组装，可手动微调">
              <Tag style={{ fontSize: 11 }}>自动组装</Tag>
            </Tooltip>
          )
        ) : (
          <Tag color="purple" style={{ fontSize: 11 }}>自由模式</Tag>
        )}
        {loading && <SyncOutlined spin style={{ color: "#999" }} />}
        <div style={{ flex: 1 }} />
        <Button
          type="primary" size="middle" icon={<PlayCircleOutlined />}
          loading={generating}
          disabled={!prompt.trim()}
          onClick={onGenerate}
        >
          生成视频
        </Button>
      </div>
      <Input.TextArea
        value={prompt}
        onChange={(e) => onPromptEdit(e.target.value)}
        placeholder={
          mode === "structured"
            ? "选择人物/场景/产品/模板后，这里会自动生成提示词…"
            : "粘贴你的完整 Seedance 视频提示词…"
        }
        autoSize={{ minRows: 8, maxRows: 18 }}
        style={{ flex: 1, resize: "none", fontSize: 13, lineHeight: 1.7 }}
      />
    </div>
  );
}