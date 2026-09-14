"use client";

import { Button, Card, Input, Space, Tag, Tooltip, Typography } from "antd";
import { PlayCircleOutlined, SyncOutlined } from "@ant-design/icons";

interface Props {
  prompt: string;        // 当前展示的提示词(结构化预览/手动改写)
  dirty: boolean;        // 用户是否手动改过(改过则提交时用此文本)
  loading: boolean;      // 预览请求中
  generating: boolean;
  onPromptEdit: (t: string) => void;
  onGenerate: () => void;
}

export default function PromptBox({ prompt, dirty, loading, generating, onPromptEdit, onGenerate }: Props) {
  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <Typography.Text strong>视频提示词</Typography.Text>
          {dirty ? (
            <Tag color="orange" style={{ fontSize: 11 }}>已手动改写（以你的内容为准）</Tag>
          ) : (
            <Tooltip title="由下方剧本配置自动组装，可手动微调">
              <Tag style={{ fontSize: 11 }}>自动组装</Tag>
            </Tooltip>
          )}
          {loading && <SyncOutlined spin style={{ color: "#999" }} />}
        </Space>
      }
      extra={
        <Button
          type="primary" size="small" icon={<PlayCircleOutlined />}
          loading={generating}
          disabled={!prompt.trim()}
          onClick={onGenerate}
        >
          生成视频
        </Button>
      }
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      styles={{ body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 12 } }}
    >
      <Input.TextArea
        value={prompt}
        onChange={(e) => onPromptEdit(e.target.value)}
        placeholder="选择人物/场景/产品后，这里会自动生成提示词；也可直接手动编写…"
        autoSize={{ minRows: 7, maxRows: 18 }}
        style={{ flex: 1, resize: "none", fontSize: 13, lineHeight: 1.7 }}
      />
    </Card>
  );
}