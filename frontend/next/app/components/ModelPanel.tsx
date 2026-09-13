"use client";

import { useState } from "react";
import {
  Button, Card, Descriptions, Divider, Empty, Form, Input, Modal, Popconfirm,
  Radio, Select, Space, Switch, Tag, Typography, message, Spin,
} from "antd";
import { ApiOutlined, PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import type { AiConfig } from "../lib/types";
import { api } from "../lib/api";

const KIND_COLOR: Record<string, string> = { video: "blue", chat: "purple", image: "green" };
const KIND_TEXT: Record<string, string> = { video: "视频生成", chat: "文本", image: "图片" };

interface Props {
  configs: AiConfig[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChanged: () => void; // 增删改后刷新
}

export default function ModelPanel({ configs, selectedId, onSelect, onChanged }: Props) {
  const [editing, setEditing] = useState<AiConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; ok: boolean; msg: string } | null>(null);
  const [form] = Form.useForm();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ kind: "video", provider: "doubao", enabled: true });
    setOpen(true);
  };
  const openEdit = (c: AiConfig) => {
    setEditing(c);
    form.resetFields();
    form.setFieldsValue({ ...c, capability: JSON.stringify(c.capability ?? {}, null, 1) });
    setOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    let capability = {};
    try { capability = v.capability ? JSON.parse(v.capability) : {}; } catch { message.warning("capability 需为合法 JSON"); return; }
    const payload = { ...v, capability };
    try {
      if (editing) await api.put(`/api/ai/configs/${editing.id}`, payload);
      else await api.post("/api/ai/configs", payload);
      message.success("已保存");
      setOpen(false);
      onChanged();
    } catch (e) { message.error(String((e as Error).message)); }
  };
  const remove = async (c: AiConfig) => {
    try { await api.del(`/api/ai/configs/${c.id}`); onChanged(); } catch (e) { message.error(String((e as Error).message)); }
  };
  const test = async (c: AiConfig) => {
    setTesting(c.id);
    setTestResult(null);
    try {
      const r = await api.post<{ ok: boolean; total: number; model_available: boolean }>("/api/ai/test", {
        api_key: c.api_key, model_id: c.model_id,
      });
      setTestResult({
        id: c.id, ok: r.ok,
        msg: `Key 有效(${r.total}个模型)${r.model_available ? "，目标模型可用" : "，目标模型不可用"}`,
      });
    } catch (e) {
      setTestResult({ id: c.id, ok: false, msg: String((e as Error).message) });
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card
      size="small" title="模型管理" style={{ height: "100%" }}
      extra={<Button size="small" icon={<PlusOutlined />} onClick={openCreate}>添加</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto", maxHeight: "calc(100vh - 140px)" }}>
        {configs.length === 0 && <Empty description="暂无模型配置" />}
        {configs.map((c) => (
          <Card
            key={c.id} size="small" type="inner"
            style={{ borderColor: selectedId === c.id ? "#1677ff" : undefined, cursor: "pointer" }}
            onClick={() => onSelect(c.id)}
            title={
              <Space>
                <Radio checked={selectedId === c.id} onClick={(e) => e.stopPropagation()} />
                <span>{c.name}</span>
                <Tag color={KIND_COLOR[c.kind] || "default"}>{KIND_TEXT[c.kind] || c.kind}</Tag>
              </Space>
            }
            extra={
              <Space size={2}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEdit(c); }} />
                <Popconfirm title="删除该模型配置?" onConfirm={() => remove(c)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                </Popconfirm>
              </Space>
            }
          >
            <Typography.Text code style={{ fontSize: 11 }}>{c.model_id}</Typography.Text>
            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{c.desc || "—"}</div>
            <Descriptions size="small" column={1} style={{ marginTop: 6, fontSize: 12 }}>
              <Descriptions.Item label="费用">{c.cost_note || "—"}</Descriptions.Item>
              <Descriptions.Item label="能力">
                {c.capability?.durations ? <>时长 {c.capability.durations.join("/")}s · </> : null}
                {c.capability?.resolutions ? c.capability.resolutions.join("/") : null}
                {c.capability?.ratios ? <> · {c.capability.ratios.join("/")}</> : null}
              </Descriptions.Item>
            </Descriptions>
            <Space style={{ marginTop: 6 }}>
              <Button size="small" loading={testing === c.id}
                icon={<ApiOutlined />} onClick={(e) => { e.stopPropagation(); test(c); }}>
                测试连接
              </Button>
              {!c.enabled && <Tag color="red">已停用</Tag>}
            </Space>
            {testResult?.id === c.id && (
              <div style={{ marginTop: 6, color: testResult.ok ? "#389e0d" : "#cf1322", fontSize: 12 }}>
                {testResult.msg}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal open={open} title={editing ? "编辑模型" : "添加模型"} onOk={submit} onCancel={() => setOpen(false)} width={520} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="如：豆包 Seedance 1.0 Pro Fast" />
          </Form.Item>
          <Form.Item name="model_id" label="模型 ID" rules={[{ required: true }]}>
            <Input placeholder="doubao-seedance-1-0-pro-fast-251015" />
          </Form.Item>
          <Form.Item name="api_key" label="API Key" extra="留空则使用后端环境变量 DOUBAO_API_KEY">
            <Input.Password placeholder="火山方舟 API Key" />
          </Form.Item>
          <Form.Item name="kind" label="能力类型">
            <Select options={[{ value: "video", label: "视频生成" }, { value: "chat", label: "文本对话" }, { value: "image", label: "图片生成" }]} />
          </Form.Item>
          <Form.Item name="capability" label="能力参数(JSON)" extra='如 {"durations":[5,10],"resolutions":["720p","1080p"],"ratios":["9:16","16:9"]}'>
            <Input.TextArea rows={3} placeholder='{"durations":[5,10]}' />
          </Form.Item>
          <Form.Item name="cost_note" label="费用说明">
            <Input placeholder="按生成秒数与分辨率计费" />
          </Form.Item>
          <Form.Item name="desc" label="能力描述 / 文字说明效果">
            <Input.TextArea rows={2} placeholder="该模型的能力与出片效果描述" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}