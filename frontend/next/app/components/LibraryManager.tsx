"use client";

import { useEffect, useState } from "react";
import {
  Button, Form, Input, Modal, Popconfirm, Space, Table, Upload, message,
} from "antd";
import type { UploadFile, UploadProps } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { api } from "../lib/api";

export type LibraryKind = "character" | "scene" | "product";

interface Props {
  kind: LibraryKind;
  open: boolean;
  onClose: () => void;
  onChanged: () => void; // 数据变更后父级刷新
}

interface RowItem {
  id: number;
  name: string;
  prompt?: string;
  photos?: string[];
  family_role?: string;
  location?: string;
  atmosphere?: string;
  timing?: string;
  desc?: string;
  category?: string;
  fit_persons?: string[];
  appear_ways?: string[];
  [k: string]: unknown;
}

const KIND_META: Record<LibraryKind, { api: string; title: string; nameLabel: string; folder: string }> = {
  character: { api: "/api/characters", title: "人物库", nameLabel: "名称", folder: "characters" },
  scene: { api: "/api/scenes", title: "场景库", nameLabel: "场景名称", folder: "scenes" },
  product: { api: "/api/products", title: "产品库", nameLabel: "产品名称", folder: "products" },
};

const PHOTO_COL = (photos?: string[]) =>
  photos && photos.length ? (
    <Space size={4} wrap>
      {photos.map((u) => (
        <img
          key={u} src={u}
          style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 4, border: "1px solid #eee" }}
        />
      ))}
    </Space>
  ) : (
    <span style={{ color: "#ccc" }}>—</span>
  );

const PROMPT_COL = (text?: string) => (
  <span
    style={{
      display: "block", maxWidth: 420, color: text ? "#333" : "#ccc",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}
    title={text || ""}
  >
    {text || "—"}
  </span>
);

/** 库管理: 人物/场景/产品 三个库的统一增删改(均为 名称 + 提示词; 人物另带多张照片) */
export default function LibraryManager({ kind, open, onClose, onChanged }: Props) {
  const meta = KIND_META[kind];
  const [rows, setRows] = useState<RowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RowItem | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();

  const refresh = async () => {
    if (!open) return;
    setLoading(true);
    try {
      setRows(await api.get<RowItem[]>(meta.api));
    } catch (e) {
      message.error(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, kind]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFileList([]);
    setFormOpen(true);
  };
  const openEdit = (r: RowItem) => {
    setEditing(r);
    form.resetFields();
    form.setFieldsValue({ name: r.name, prompt: r.prompt || "" });
    setFileList(
      (r.photos || []).map((u) => ({
        uid: u, name: u.split("/").pop() || "photo", status: "done", url: u,
      }))
    );
    setFormOpen(true);
  };
  const closeForm = () => setFormOpen(false);

  const submit = async () => {
    const v = await form.validateFields();
    const payload: Record<string, unknown> = { ...v, active: 1 };
    payload.prompt = v.prompt || "";
    if (kind === "character") {
      payload.photos = fileList
        .filter((f) => f.status === "done" && (f.url || (f.response as { url?: string } | undefined)?.url))
        .map((f) => (f.url || (f.response as { url: string }).url) as string);
      // 老字段保留列, 新录入不要求
      payload.family_role = ""; payload.age = 0;
      payload.profession = ""; payload.traits = ""; payload.look = "";
    } else if (kind === "scene") {
      // 老字段保留(不在表单中维护, 沿用原值)
      payload.location = (editing?.location as string) ?? "";
      payload.desc = (editing?.desc as string) ?? "";
      payload.atmosphere = (editing?.atmosphere as string) ?? "";
      payload.timing = (editing?.timing as string) ?? "";
    } else {
      payload.category = (editing?.category as string) ?? "";
      payload.fit_persons = (editing?.fit_persons as string[]) ?? [];
      payload.appear_ways = (editing?.appear_ways as string[]) ?? [];
      payload.desc = (editing?.desc as string) ?? "";
    }
    try {
      if (editing) await api.put(`${meta.api}/${editing.id}`, payload);
      else await api.post(meta.api, payload);
      message.success("已保存");
      closeForm();
      refresh();
      onChanged();
    } catch (e) {
      message.error(String((e as Error).message));
    }
  };

  const remove = async (r: RowItem) => {
    try {
      await api.del(`${meta.api}/${r.id}`);
      message.success("已删除");
      refresh();
      onChanged();
    } catch (e) {
      message.error(String((e as Error).message));
    }
  };

  const actionCol = {
    title: "操作",
    width: 90,
    render: (_: unknown, r: RowItem) => (
      <Space size={2}>
        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
        <Popconfirm title="确认删除该记录?" onConfirm={() => remove(r)}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    ),
  };

  const columns =
    kind === "character"
      ? [
          { title: "名称", width: 110, render: (_: unknown, r: RowItem) => <span>{r.name}</span> },
          { title: "人物提示词", render: (_: unknown, r: RowItem) => PROMPT_COL(r.prompt) },
          { title: "照片", width: 130, render: (_: unknown, r: RowItem) => PHOTO_COL(r.photos) },
          actionCol,
        ]
      : [
          { title: meta.nameLabel, width: 140, render: (_: unknown, r: RowItem) => <span>{r.name}</span> },
          {
            title: kind === "scene" ? "场景提示词" : "产品提示词",
            render: (_: unknown, r: RowItem) => PROMPT_COL(r.prompt),
          },
          actionCol,
        ];

  const uploadProps: UploadProps = {
    listType: "picture-card",
    multiple: true,
    accept: "image/*",
    fileList,
    customRequest: async (o) => {
      try {
        const fd = new FormData();
        fd.append("file", o.file as File);
        fd.append("folder", meta.folder);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await r.json();
        if (!j.ok) throw new Error(j.msg);
        o.onSuccess?.(j);
      } catch (e) {
        o.onError?.(e as Error);
      }
    },
    onChange: ({ fileList: fl }) => setFileList(fl),
  };

  const promptLabel = kind === "character" ? "人物提示词" : kind === "scene" ? "场景提示词" : "产品提示词";
  const promptPlaceholder =
    kind === "character"
      ? "如：老周，48岁，销售经理。经常应酬，话少不会表达。外形：深色夹克、公文包。"
      : kind === "scene"
        ? "如：家门口玄关，傍晚。丈夫弯腰系鞋带，妻子递包。氛围生活、克制。"
        : "如：枸杞原浆，养生饮品。放进冰箱并留下一张纸条；画面保留2-3秒清晰露出。";

  return (
    <Modal
      open={open}
      title={meta.title}
      width={760}
      onCancel={onClose}
      footer={[
        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增</Button>,
        <Button key="close" onClick={onClose}>关闭</Button>,
      ]}
    >
      <Table<RowItem>
        size="small" rowKey="id" columns={columns} dataSource={rows} loading={loading}
        pagination={false} scroll={{ y: 430 }}
      />

      <Modal
        open={formOpen} title={editing ? "编辑" : "新增"} onOk={submit} onCancel={closeForm}
        width={560} destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={meta.nameLabel} rules={[{ required: true, message: `请输入${meta.nameLabel}` }]}>
            <Input placeholder={kind === "character" ? "如：老周" : kind === "scene" ? "如：玄关换鞋" : "如：枸杞原浆"} />
          </Form.Item>
          <Form.Item name="prompt" label={promptLabel} extra="生成视频时描述画面内容，越具体生成的画面越一致">
            <Input.TextArea rows={4} placeholder={promptPlaceholder} />
          </Form.Item>

          {kind === "character" && (
            <Form.Item label="照片（可多张）">
              <Upload {...uploadProps}>
                <div style={{ fontSize: 12 }}>+ 上传</div>
              </Upload>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>支持 jpg/png/webp，每张 ≤ 10MB</div>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Modal>
  );
}