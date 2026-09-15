"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, ConfigProvider, DatePicker, Empty, Form, Input, Modal, Popconfirm, Table, Tabs, Tooltip, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import zhCN from "antd/locale/zh_CN";
import type { UploadFile } from "antd/es/upload/interface";

interface Script {
  id: number;
  name: string;
  file_path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 10; // 每页条数(滚动到底自动加载下一页)
const ACCEPT_FILES = ".txt,.docx"; // 支持的文件类型

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

/** 上传 URL(/api/uploads/scripts/xxx.txt) → data 内相对路径(显示用) */
function filePathOf(url: string): string {
  const m = /^\/(api\/uploads\/.*)$/.exec(url);
  return m ? `data/${m[1]}` : url;
}

/** 剧本模块: 文件/提示词添加 + 拖拽 + 筛选 + 滚动加载 + 选择列批量删除 + 右键删除 */
export default function ScriptModule() {
  const { message } = AntApp.useApp(); // 上下文 message(消费动态主题), 替代静态 message
  const [items, setItems] = useState<Script[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);        // 首页/刷新加载
  const [loadingMore, setLoadingMore] = useState(false); // 滚动加载中
  const [selected, setSelected] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null); // 行右键菜单
  const [dragging, setDragging] = useState(false);      // 拖拽高亮
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [textForm] = Form.useForm();

  // 筛选条件(ref 供滚动加载使用, 避免闭包旧值)
  const filterRef = useRef<{ kw: string; dates: [string, string] | null }>({ kw: "", dates: null });
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasMore = items.length < total;

  // ---------- 数据加载 ----------
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

  // 其他模块(如 AI 对话通过工具新增剧本)通知后自动刷新
  useEffect(() => {
    const refresh = (): void => applyFilter();
    window.addEventListener("scripts-changed", refresh);
    return () => window.removeEventListener("scripts-changed", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modal 渲染完成后重置提示词表单(避免在实例未连接时 resetFields 触发 antd 警告)
  useEffect(() => {
    if (modalOpen) textForm.resetFields();
  }, [modalOpen, textForm]);

  const applyFilter = (): void => {
    const { kw, dates } = filterRef.current;
    setPage(1);
    void load(1, false, kw, dates);
  };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      const next = page + 1;
      setPage(next);
      void load(next, true, filterRef.current.kw, filterRef.current.dates);
    }
  };

  // ---------- 添加: 上传文件(单次) ----------
  const uploadOne = async (f: File): Promise<void> => {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/scripts/upload", { method: "POST", body: fd });
    const j = (await r.json()) as { detail?: string; ok?: boolean; name?: string };
    if (!r.ok) throw new Error(j.detail || `上传失败: ${f.name}`);
    message.success(`已添加: ${j.name ?? f.name}`);
  };

  // 弹窗内选择文件(多个)
  const handlePickerFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return;
    try {
      for (const f of files) await uploadOne(f);
      setFileList([]);
      setModalOpen(false);
      setSelected([]);
      applyFilter();
    } catch (e) {
      message.error((e as Error).message);
      setFileList([]);
    }
  };

  // 模块内直接拖入文件
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    try {
      for (const f of files) await uploadOne(f);
      setSelected([]);
      applyFilter();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  // ---------- 添加: 粘贴提示词 ----------
  const saveText = async (): Promise<void> => {
    let values: { name?: string; content: string };
    try {
      values = await textForm.validateFields();
    } catch { return; }
    setSaving(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name || "", content: values.content }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      message.success("已添加");
      setModalOpen(false);
      textForm.resetFields();
      setSelected([]);
      applyFilter();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- 删除 ----------
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
    setFileList([]);
    setModalOpen(true);
  };

  // 点击行: 切换勾选(高亮 + 选中联动)
  const toggleSelect = (id: number): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const columns: ColumnsType<Script> = [
    {
      title: "名称", dataIndex: "name", key: "name",
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <span style={{ fontSize: 13 }}>{v}</span>
        </Tooltip>
      ),
    },
    {
      title: "文件路径", dataIndex: "file_path", key: "file_path", width: 150,
      ellipsis: true,
      render: (v: string) =>
        v
          ? <span style={{ fontSize: 12, color: "#888" }} title={v}>{filePathOf(v)}</span>
          : <span style={{ fontSize: 12, color: "#ccc" }}>—</span>,
    },
    {
      title: "创建时间", dataIndex: "created_at", key: "created_at", width: 142,
      render: (v: string) => <span style={{ fontSize: 12, color: "#999" }}>{fmtDateTime(v)}</span>,
    },
  ];

  return (
    <div
      style={{ flex: 1, minHeight: 0, width: 460, display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid #e5e5e5", background: "#fff", overflow: "hidden" }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* 拖拽悬停高亮遮罩 */}
      {dragging && (
        <div style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.06)", border: "2px dashed #000", borderRadius: 12, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 14 }}>
          松开添加剧本文件
        </div>
      )}

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
            onRow={(rec) => ({
              onContextMenu: (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: rec.id }); },
              onClick: () => toggleSelect(rec.id),
            })}
            rowClassName={(rec) => (selected.includes(rec.id) ? "script-row-active" : "")}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as number[]),
            }}
          />
        </ConfigProvider>
        {loadingMore && <div style={{ textAlign: "center", padding: 10, fontSize: 12, color: "#bbb" }}>加载中…</div>}
        {!hasMore && items.length > 0 && <div style={{ textAlign: "center", padding: 10, fontSize: 12, color: "#ccc" }}>没有更多了</div>}
      </div>

      {/* 底部工具栏: 批量删除(常驻, 未选中置灰) + 新增(靠右) */}
      <div style={{ borderTop: "1px solid #eee", padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <Popconfirm
          title={`确认删除选中的 ${selected.length} 条剧本？`}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
          onConfirm={() => void delBatch()}
          disabled={!selected.length}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={!selected.length}
            style={{ height: 40 }}
          >
            批量删除{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </Popconfirm>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openAdd}
          title="添加剧本"
          style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, fontSize: 16 }}
        />
      </div>

      
{/* 行右键菜单: 删除 */}
      {menu && (
        <>
          <div
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
          />
          <div style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 31, minWidth: 96, background: "#fff", border: "1px solid #eee", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden" }}>
            <div
              className="conv-menu-item"
              onClick={() => { const id = menu.id; setMenu(null); void delOne(id); }}
              style={{ padding: "8px 14px", fontSize: 13, color: "#ff4d4f", cursor: "pointer" }}
            >
              删除
            </div>
          </div>
        </>
      )}

      {/* 添加弹窗: 上传文件 / 粘贴提示词 */}
      <Modal
        open={modalOpen}
        title="添加剧本"
        footer={null}
        onCancel={() => setModalOpen(false)}
        width={460}
        destroyOnHidden
      >
        <Tabs
          items={[
            {
              key: "file",
              label: "上传文件",
              children: (
                <Upload.Dragger
                  multiple
                  accept={ACCEPT_FILES}
                  fileList={fileList}
                  beforeUpload={(_f, files) => { void handlePickerFiles(files); return false; }}
                  onChange={({ fileList: fl }) => setFileList(fl)}
                  style={{ padding: "6px 0" }}
                >
                  <p style={{ fontSize: 14, color: "#888", margin: 0 }}>点击或拖入文件</p>
                  <p style={{ fontSize: 12, color: "#bbb", margin: "6px 0 0" }}>支持 .txt / .docx（word 图片会一并提取）</p>
                </Upload.Dragger>
              ),
            },
            {
              key: "text",
              label: "粘贴提示词",
              children: (
                <Form form={textForm} layout="vertical" style={{ marginTop: 8 }}>
                  <Form.Item name="content" rules={[{ required: true, message: "请输入剧本内容/提示词" }]}>
                    <Input.TextArea
                      placeholder="输入一大段剧本内容或提示词…（名称留空时自动取首行）"
                      autoSize={{ minRows: 6, maxRows: 12 }}
                      style={{ fontSize: 13 }}
                    />
                  </Form.Item>
                  <Form.Item name="name" label="名称（可选）">
                    <Input placeholder="留空则自动从内容首行生成" maxLength={100} />
                  </Form.Item>
                  <Button type="primary" block loading={saving} onClick={() => void saveText()}>
                    添加
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}