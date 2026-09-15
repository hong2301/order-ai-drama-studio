"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ConfigProvider, DatePicker, Empty, Form, Input, Modal, Popconfirm, Table, message } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import zhCN from "antd/locale/zh_CN";

interface Script {
  id: number;
  name: string;
  file_path: string;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 10; // 每页条数(滚动到底自动加载下一页)

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

/** 剧本模块: 筛选(名称/创建日期) + 滚动加载列表 + 选择列批量删除 + 增删改 */
export default function ScriptModule() {
  const [items, setItems] = useState<Script[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);        // 首页/刷新加载
  const [loadingMore, setLoadingMore] = useState(false); // 滚动加载中
  const [selected, setSelected] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Script | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // 筛选条件(ref 供滚动加载使用, 避免闭包旧值)
  const filterRef = useRef<{ kw: string; dates: [string, string] | null }>({ kw: "", dates: null });
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasMore = items.length < total;

  // 请求一页(append=false 刷新, true 追加)
  const load = useCallback((p: number, append: boolean, kw: string, dates: [string, string] | null): void => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    const q = new URLSearchParams({ name: kw, page: String(p), page_size: String(PAGE_SIZE) });
    if (dates) { q.set("date_from", dates[0]); q.set("date_to", dates[1]); }
    fetch(`/api/scripts?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载失败"))))
      .then((j: { items?: Script[]; total?: number }) => {
        setTotal(Number(j.total) || 0);
        setItems((prev) => (append ? [...prev, ...(j.items || [])] : (j.items || [])));
      })
      .catch((e: Error) => message.error(e.message))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, []);

  useEffect(() => { void load(1, false, "", null); }, [load]);

  // 筛选条件变化 → 重置第一页
  const applyFilter = (): void => {
    const { kw, dates } = filterRef.current;
    setPage(1);
    void load(1, false, kw, dates);
  };

  // 滚动到底加载下一页
  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      const next = page + 1;
      setPage(next);
      void load(next, true, filterRef.current.kw, filterRef.current.dates);
    }
  };

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
      const j = (await r.json()) as { detail?: string };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      message.success(editing ? "已更新" : "已新增");
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      setSelected([]);
      applyFilter();
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
      applyFilter();
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
      const j = (await r.json()) as { detail?: string; deleted?: number };
      if (!r.ok) throw new Error(j.detail || "批量删除失败");
      message.success(`已删除 ${j.deleted ?? selected.length} 条`);
      setSelected([]);
      applyFilter();
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
      {/* 筛选栏: 名称搜索 + 创建日期范围 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #eee" }}>
        <Input
          placeholder="按名称搜索"
          prefix={<SearchOutlined style={{ color: "#bbb" }} />}
          allowClear
          style={{ flex: 1 }}
          onChange={(e) => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              filterRef.current = { ...filterRef.current, kw: e.target.value.trim() };
              applyFilter();
            }, 300);
          }}
        />
        <DatePicker.RangePicker
          size="small"
          onChange={(vals) => {
            if (vals && vals[0] && vals[1]) {
              filterRef.current = { ...filterRef.current, dates: [vals[0].format("YYYY-MM-DD"), vals[1].format("YYYY-MM-DD")] };
            } else {
              filterRef.current = { ...filterRef.current, dates: null };
            }
            applyFilter();
          }}
        />
      </div>

      {/* 顶部工具栏: 仅选中行时显示批量删除 */}
      {selected.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #eee" }}>
          <Popconfirm
            title={`确认删除选中的 ${selected.length} 条剧本？`}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
            onConfirm={() => void delBatch()}
          >
            <Button danger size="small" icon={<DeleteOutlined />}>
              批量删除 ({selected.length})
            </Button>
          </Popconfirm>
        </div>
      )}

      {/* 滚动加载列表 */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
        <ConfigProvider locale={zhCN}>
          <Table<Script>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={items}
            columns={columns}
            pagination={false}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有剧本" style={{ padding: 24 }} /> }}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as number[]),
            }}
          />
        </ConfigProvider>
        {loadingMore && <div style={{ textAlign: "center", padding: 10, fontSize: 12, color: "#bbb" }}>加载中…</div>}
        {!hasMore && items.length > 0 && <div style={{ textAlign: "center", padding: 10, fontSize: 12, color: "#ccc" }}>没有更多了</div>}
      </div>

      {/* 底部工具栏: 新增按钮(靠右) */}
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