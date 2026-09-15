"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ConfigProvider, Empty, Form, Input, Modal, Popconfirm, Table, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import zhCN from "antd/locale/zh_CN";

interface Script {
  id: number;
  name: string;
  file_path: string;
  created_at: string;
  updated_at: string;
}

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

/** 剧本模块: 剧本列表(带选择列可批量删除) + 新增/编辑/删除 CRUD */
export default function ScriptModule() {
  const [data, setData] = useState<Script[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number[]>([]); // 勾选的行(批量删除)
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Script | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/scripts");
      const j = (await r.json()) as unknown;
      setData(Array.isArray(j) ? (j as Script[]) : []);
    } catch {
      message.error("加载剧本列表失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 新增 / 编辑共用保存
  const save = async (): Promise<void> => {
    let values: { name: string; file_path?: string };
    try {
      values = await form.validateFields();
    } catch { return; }
    setSaving(true);
    try {
      const url = editing ? `/api/scripts/${editing.id}` : "/api/scripts";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, file_path: values.file_path || "" }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      message.success(editing ? "已更新" : "已新增");
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      setSelected([]);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // 删除单个
  const delOne = async (id: number): Promise<void> => {
    try {
      const r = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("删除失败");
      message.success("已删除");
      setSelected((s) => s.filter((x) => x !== id));
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // 批量删除
  const delBatch = async (): Promise<void> => {
    if (!selected.length) return;
    try {
      const r = await fetch("/api/scripts/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean; deleted?: number };
      if (!r.ok) throw new Error(j.detail || "批量删除失败");
      message.success(`已删除 ${j.deleted ?? selected.length} 条`);
      setSelected([]);
      void load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const openAdd = (): void => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };
  const openEdit = (rec: Script): void => {
    setEditing(rec);
    form.setFieldsValue({ name: rec.name, file_path: rec.file_path });
    setModalOpen(true);
  };

  const columns: ColumnsType<Script> = [
    {
      title: "名称", dataIndex: "name", key: "name",
      ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 13 }}>{v}</span>,
    },
    {
      title: "文件路径", dataIndex: "file_path", key: "file_path",
      ellipsis: true,
      render: (v: string) =>
        v ? <span style={{ fontSize: 12, color: "#888" }} title={v}>{v}</span> : <span style={{ fontSize: 12, color: "#ccc" }}>—</span>,
    },
    {
      title: "创建时间", dataIndex: "created_at", key: "created_at", width: 142,
      render: (v: string) => <span style={{ fontSize: 12, color: "#999" }}>{fmtDateTime(v)}</span>,
    },
    {
      title: "操作", key: "ops", width: 76,
      render: (_v, rec) => (
        <>
          <Button type="text" size="small" icon={<EditOutlined />} title="编辑" onClick={() => openEdit(rec)} style={{ marginRight: 2 }} />
          <Popconfirm title="确认删除这条剧本？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void delOne(rec.id)}>
            <Button type="text" size="small" icon={<DeleteOutlined style={{ color: "#ff4d4f" }} />} title="删除" />
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <div style={{ width: 460, display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid #e5e5e5", background: "#fff", overflow: "hidden" }}>
      {/* 顶部工具栏: 批量删除(选中时出现) */}
      <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #eee", minHeight: 40 }}>
        {selected.length > 0 && (
          <Popconfirm
            title={`确认删除选中的 ${selected.length} 条剧本？`}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            onConfirm={() => void delBatch()}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              批量删除 ({selected.length})
            </Button>
          </Popconfirm>
        )}
      </div>

      {/* 剧本列表(左侧选择列) */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 8 }}>
        <ConfigProvider locale={zhCN}>
          <Table<Script>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={data}
            columns={columns}
            pagination={{ pageSize: 8, size: "small", showTotal: (t) => `共 ${t} 条` }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有剧本" style={{ padding: 24 }} /> }}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as number[]),
            }}
          />
        </ConfigProvider>
      </div>

      {/* 底部: 新增按钮(靠右) */}
      <div style={{ borderTop: "1px solid #eee", padding: 10, display: "flex", justifyContent: "flex-end" }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openAdd}
          title="新增剧本"
          style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, fontSize: 16 }}
        />
      </div>

      {/* 新增 / 编辑弹窗 */}
      <Modal
        open={modalOpen}
        title={editing ? "编辑剧本" : "新增剧本"}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入剧本名称" }]}>
            <Input placeholder="剧本名称" maxLength={100} />
          </Form.Item>
          <Form.Item name="file_path" label="文件路径">
            <Input placeholder="剧本文件的路径（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}