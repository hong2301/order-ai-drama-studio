"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, ConfigProvider, Empty, Form, Input, Modal, Popconfirm, Select, Table, Tag, Tooltip, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import zhCN from "antd/locale/zh_CN";
import type { UploadFile } from "antd/es/upload/interface";

interface ImageItem { id: number; path: string; name: string; description: string }
interface CardItem {
  id: number;
  name: string;
  identity: string[];
  prompt: string;
  image_ids: number[];
  images?: ImageItem[];
  created_at: string;
}

const PAGE_SIZE = 10;

function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

/** 通用资料库模块(人物/场景/产品): 列表 + 自定义字段 + 图片选择 + CRUD */
export default function InfoCardModule(props: {
  title: string;
  api: string;              // /api/characters
  identityLabel: string;    // 身份/类型/品类
  identityPlaceholder: string;
  showIdentity?: boolean;   // 是否展示身份(类型/品类)字段(场景/产品不需要)
}) {
  const { title, api, identityLabel, identityPlaceholder, showIdentity = true } = props;
  const { message } = AntApp.useApp();

  const [items, setItems] = useState<CardItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // 图片资源库
  const [library, setLibrary] = useState<ImageItem[]>([]);
  const [pickedImgs, setPickedImgs] = useState<number[]>([]); // 弹窗内已选图片 ids

  const filterRef = useRef<{ kw: string }>({ kw: "" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [form] = Form.useForm();

  const hasMore = items.length < total;

  // 加载图片资源库
  const loadLibrary = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch("/api/images");
      const j = (await r.json()) as unknown;
      setLibrary(Array.isArray(j) ? (j as ImageItem[]) : []);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback((p: number, append: boolean, kw: string): void => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    const q = new URLSearchParams({ name: kw, page: String(p), page_size: String(PAGE_SIZE) });
    fetch(`${api}?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载失败"))))
      .then((j: { items?: CardItem[]; total?: number }) => {
        setTotal(Number(j.total) || 0);
        setItems((prev) => (append ? [...prev, ...(j.items || [])] : (j.items || [])));
      })
      .catch((e: Error) => message.error(e.message))
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, [api, message]);

  useEffect(() => { void load(1, false, ""); void loadLibrary(); }, [load, loadLibrary]);

  // AI 对话等模块新增后自动刷新
  useEffect(() => {
    window.addEventListener("scripts-changed", () => load(1, false, filterRef.current.kw));
    return () => window.removeEventListener("scripts-changed", () => load(1, false, filterRef.current.kw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = (): void => { setPage(1); void load(1, false, filterRef.current.kw); };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      const next = page + 1;
      setPage(next);
      void load(next, true, filterRef.current.kw);
    }
  };

  // 新增保存
  const save = async (): Promise<void> => {
    let values: { name: string; identity?: string[]; prompt?: string };
    try { values = await form.validateFields(); } catch { return; }
    try {
      const r = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, identity: values.identity || [], prompt: values.prompt || "", image_ids: pickedImgs }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      message.success("已添加");
      setModalOpen(false);
      setPickedImgs([]);
      form.resetFields();
      setSelected([]);
      applyFilter();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // 图片选择: 上传新图
  const uploadImg = async (f: File): Promise<void> => {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/images/upload", { method: "POST", body: fd });
    const j = (await r.json()) as { detail?: string; ok?: boolean; id?: number };
    if (!r.ok) throw new Error(j.detail || "上传失败");
    await loadLibrary();
    if (j.id) setPickedImgs((prev) => [...prev, j.id as number]);
    message.success("图片已上传");
  };

  const delOne = async (id: number): Promise<void> => {
    try {
      const r = await fetch(`${api}/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("删除失败");
      message.success("已删除");
      setSelected((s) => s.filter((x) => x !== id));
      applyFilter();
    } catch (e) { message.error((e as Error).message); }
  };

  const delBatch = async (): Promise<void> => {
    if (!selected.length) return;
    try {
      const r = await fetch(`${api}/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected }),
      });
      const j = (await r.json()) as { detail?: string; deleted?: number };
      if (!r.ok) throw new Error(j.detail || "批量删除失败");
      message.success(`已删除 ${j.deleted ?? selected.length} 条`);
      setSelected([]);
      applyFilter();
    } catch (e) { message.error((e as Error).message); }
  };

  const toggleSelect = (id: number): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openAdd = (): void => {
    setPickedImgs([]);
    setModalOpen(true);
  };
  // Modal 渲染完成后重置表单(避免实例未连接时 resetFields 触发警告)
  useEffect(() => {
    if (modalOpen) form.resetFields();
  }, [modalOpen, form]);

  const columns: ColumnsType<CardItem> = [
    {
      title: "名称", dataIndex: "name", key: "name",
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft"><span style={{ fontSize: 13 }}>{v}</span></Tooltip>
      ),
    },
    ...(showIdentity
      ? [{
          title: identityLabel, dataIndex: "identity", key: "identity",
          render: (v: string[]) => (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {Array.isArray(v) && v.length > 0
                ? v.slice(0, 3).map((t) => <Tag key={t} style={{ fontSize: 11, margin: 0 }}>{t}</Tag>)
                : <span style={{ fontSize: 12, color: "#ccc" }}>—</span>}
            </div>
          ),
        } as ColumnsType<CardItem>[number]]
      : []),
    {
      title: "提示词", dataIndex: "prompt", key: "prompt",
      ellipsis: true,
      render: (v: string) =>
        v
          ? <Tooltip title={v} placement="topLeft"><span style={{ fontSize: 12, color: "#888" }}>{v}</span></Tooltip>
          : <span style={{ fontSize: 12, color: "#ccc" }}>—</span>,
    },
  ];

  return (
    <div
      style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid #e5e5e5", background: "#fff", overflow: "hidden" }}
    >
      {/* 模块标题行: 标题 + 搜索/批量删除/新增(全在右侧) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: "1px solid #eee" }}>
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
        <div style={{ flex: 1 }} />
        <Input
          placeholder="搜索名称"
          prefix={<SearchOutlined style={{ color: "#bbb" }} />}
          allowClear
          size="small"
          style={{ width: 110 }}
          onChange={(e) => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => { filterRef.current = { kw: e.target.value.trim() }; applyFilter(); }, 300);
          }}
        />
        <Popconfirm
          title={`确认删除选中的 ${selected.length} 条？`}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
          onConfirm={() => void delBatch()}
          disabled={!selected.length}
        >
          <Button danger icon={<DeleteOutlined style={{ fontSize: 12 }} />} disabled={!selected.length} title="批量删除" style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }} />
        </Popconfirm>
        <Button
          type="primary"
          icon={<PlusOutlined style={{ fontSize: 12 }} />}
          onClick={openAdd}
          title={`新增${title}`}
          style={{ width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        />
      </div>

      {/* 列表(滚动加载) */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
        <ConfigProvider locale={zhCN}>
          <Table<CardItem>
            className="clickable-table"
            rowKey="id"
            size="small"
            showHeader={false}
            loading={loading}
            dataSource={items}
            columns={columns}
            pagination={false}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 12, color: "#bbb" }}>暂无{title}</span>} style={{ margin: "6px 0", padding: 0 }} /> }}
            onRow={(rec) => ({
              onContextMenu: (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: rec.id }); },
              onClick: () => toggleSelect(rec.id),
            })}
            rowClassName={(rec) => (selected.includes(rec.id) ? "script-row-active" : "")}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]) }}
          />
        </ConfigProvider>
        {loadingMore && <div style={{ textAlign: "center", padding: 8, fontSize: 12, color: "#bbb" }}>加载中…</div>}
        {!hasMore && items.length > 0 && <div style={{ textAlign: "center", padding: 8, fontSize: 12, color: "#ccc" }}>没有更多了</div>}
      </div>

      {/* 行右键菜单 */}
      {menu && (
        <>
          <div onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
          <div style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 31, minWidth: 96, background: "#fff", border: "1px solid #eee", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden" }}>
            <div className="conv-menu-item" onClick={() => { const id = menu.id; setMenu(null); void delOne(id); }} style={{ padding: "8px 14px", fontSize: 13, color: "#ff4d4f", cursor: "pointer" }}>删除</div>
          </div>
        </>
      )}

      {/* 新增弹窗 */}
      <Modal open={modalOpen} title={`新增${title}`} onCancel={() => { setModalOpen(false); setPickedImgs([]); form.resetFields(); }} onOk={() => void save()} okText="添加" cancelText="取消" width={440} destroyOnHidden>
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="名称" maxLength={80} />
          </Form.Item>
          {showIdentity && (
            <Form.Item name="identity" label={identityLabel}>
              <Select mode="tags" placeholder={identityPlaceholder} open={false} suffixIcon={null} style={{ width: "100%" }} tokenSeparators={[",", "，"]} />
            </Form.Item>
          )}
          <Form.Item name="prompt" label="提示词">
            <Input.TextArea placeholder="该对象的提示词/描述（可选）" autoSize={{ minRows: 3, maxRows: 6 }} style={{ fontSize: 13 }} />
          </Form.Item>
          <Form.Item label="图片（可多选）">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {library.map((img) => (
                <div
                  key={img.id}
                  onClick={() => setPickedImgs((prev) => (prev.includes(img.id) ? prev.filter((x) => x !== img.id) : [...prev, img.id]))}
                  title={img.name || img.description}
                  style={{ position: "relative", width: 48, height: 48, borderRadius: 8, overflow: "hidden", border: pickedImgs.includes(img.id) ? "2px solid #000" : "1px solid #eee", cursor: "pointer", flexShrink: 0 }}
                >
                  <img src={img.path} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
              ))}
              {/* 上传新图 */}
              <div onClick={() => fileRef.current?.click()} style={{ width: 48, height: 48, borderRadius: 8, border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 22, cursor: "pointer" }}>
                +
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try { await uploadImg(f); } catch (err) { message.error((err as Error).message); }
                }}
              />
            </div>
            {pickedImgs.length > 0 && <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>已选 {pickedImgs.length} 张</div>}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}