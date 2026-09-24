"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, ConfigProvider, Empty, Form, Input, Modal, Popconfirm, Select, Table, Tabs, Tag, Tooltip, Upload } from "antd";
import { DeleteOutlined, FolderOpenOutlined, PaperClipOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import zhCN from "antd/locale/zh_CN";
import type { UploadFile } from "antd/es/upload/interface";
import ImageGalleryModal, { type GalleryImage } from "./ImageGalleryModal";

interface ImageItem { id: number; path: string; name: string; description: string }
interface CardItem {
  id: number;
  name: string;
  identity: string[];
  prompt: string;
  image_ids: number[];
  images?: GalleryImage[];
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
  const { message, modal } = AntApp.useApp();

  const [items, setItems] = useState<CardItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 列表数据(用于联动选中)
  const [selected, setSelected] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false); // 文件夹导入中

  // 图片资源库
  const [library, setLibrary] = useState<ImageItem[]>([]);
  const [pickedImgs, setPickedImgs] = useState<number[]>([]); // 弹窗内已选图片 ids
  // 图库管理弹窗(点击列表缩略图打开)
  const [gallery, setGallery] = useState<{ open: boolean; record: CardItem | null }>({ open: false, record: null });

  const filterRef = useRef<{ kw: string }>({ kw: "" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importFilesRef = useRef<HTMLInputElement | null>(null);   // 选择多个文件
  const importFolderRef = useRef<HTMLInputElement | null>(null);  // 选择文件夹(webkitdirectory)
  const [pasteContent, setPasteContent] = useState("");
  const [editPrompt, setEditPrompt] = useState<{ open: boolean; id: number; value: string }>({ open: false, id: 0, value: "" }); // 提示词弹窗编辑
  const activeScriptRef = useRef<number | null>(null); // 当前联动剧本 id(反向写回用)
  const [idAdding, setIdAdding] = useState<number | null>(null); // 正在新增身份的记录 id
  const [newIdText, setNewIdText] = useState("");
  const linkRef = useRef<number[] | null>(null); // 待置顶的联动 id
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

  // 导入统一入口: files(文件/文件夹) 或 content(粘贴提示词)
  const callImport = async (files: File[] | null, content: string): Promise<void> => {
    const type = api.split("/").filter(Boolean).pop() || "characters"; // /api/characters -> characters
    const fd = new FormData();
    fd.append("type", type);
    if (content.trim()) fd.append("content", content);
    for (const f of files || []) fd.append("files", f, f.webkitRelativePath || f.name);
    setImporting(true);
    try {
      const r = await fetch("/api/library/import", { method: "POST", body: fd });
      const j = (await r.json()) as { detail?: string; name?: string; identity?: string[]; images?: number[] };
      if (!r.ok) throw new Error(j.detail || "导入失败");
      message.success(`已导入「${j.name}」(标签 ${(j.identity || []).length} 个 · 图片 ${(j.images || []).length} 张)`);
      setModalOpen(false);
      setPasteContent("");
      setSelected([]);
      applyFilter();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) void callImport(files, "");
  };

  // 剧本联动: 选中剧本时, 本库对应记录置顶并选中(按「名称」定位 —— 库内同名记录已合并, 名称比 id 可靠)
  useEffect(() => {
    const onLink = (e: Event): void => {
      const d = (e as CustomEvent).detail as {
        chars: number[]; scenes: number[]; prods: number[];
        charNames?: string[]; sceneNames?: string[]; prodNames?: string[];
        unlink?: boolean;
        scriptId?: number | null;
      };
      // 记录当前联动剧本(反向写回用)
      activeScriptRef.current = d.unlink ? null : (d.scriptId ?? null);
      // 取消剧本选中: 撤掉之前联动选中的记录, 恢复原列表
      if (d.unlink) {
        const linked = linkRef.current || [];
        if (linked.length) {
          setSelected((prev) => prev.filter((n) => !linked.includes(n)));
          void load(1, false, filterRef.current.kw);
        }
        linkRef.current = [];
        return;
      }
      const type = api.split("/").filter(Boolean).pop(); // characters/scenes/products
      const ids = (type === "characters" ? d.chars : type === "scenes" ? d.scenes : d.prods) || [];
      const names = (type === "characters" ? d.charNames : type === "scenes" ? d.sceneNames : d.prodNames) || [];
      if (!ids.length && !names.length) return;
      linkRef.current = ids;
      // 按名称批量定位(名称归一化匹配, 同名记录全部命中) → 置顶 + 选中
      const q = new URLSearchParams();
      if (names.length) q.set("names", names.join(","));
      else q.set("ids", ids.join(","));
      fetch(`${api}?${q.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("联动查询失败"))))
        .then((j: { items?: CardItem[] }) => {
          const recs = j.items || [];
          if (!recs.length) return;
          const recIds = recs.map((x) => x.id);
          linkRef.current = recIds; // 取消选中时按实际命中的记录撤销
          setItems((prev) => [...recs, ...prev.filter((p) => !recIds.includes(p.id))]); // 置顶
          // 兜底策略: 选中剧本时三库选中=该剧本关联的物料, 不属于的(含手动勾选的)一律取消
          setSelected([...recIds]);
        })
        .catch(() => { /* 联动失败静默 */ });
    };
    window.addEventListener("library-link", onLink);
    return () => window.removeEventListener("library-link", onLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, load]);

  // 新增保存(手动填写)
  // 保存该记录的 identity 数组
  const saveIdentity = async (id: number, next: string[]): Promise<void> => {
    try {
      const r = await fetch(`${api}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: next }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, identity: next } : x)));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // 新增身份(追加到末尾)
  const addIdentity = async (rec: CardItem, val: string): Promise<void> => {
    const t = val.trim();
    if (!t) return;
    if (rec.identity.includes(t)) { message.warning("该身份已存在"); return; }
    await saveIdentity(rec.id, [...rec.identity, t]);
    setIdAdding(null);
    setNewIdText("");
  };

  // 右键删除身份(二次确认)
  const removeIdentity = (rec: CardItem, val: string): void => {
    modal.confirm({
      title: `删除身份「${val}」？`,
      okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => { await saveIdentity(rec.id, rec.identity.filter((t) => t !== val)); },
    });
  };

  // 切换默认身份: 选中项移到数组首位并入库
  const setDefaultIdentity = async (id: number, arr: string[], val: string): Promise<void> => {
    if (!val) return;
    const next = [val, ...arr.filter((t) => t !== val)];
    try {
      const r = await fetch(`${api}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: next }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, identity: next } : x)));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // 提示词弹窗保存(部分更新 PUT, 其他字段保留)
  const savePrompt = async (id: number, value: string): Promise<void> => {
    setEditPrompt((p) => ({ ...p, open: false }));
    try {
      const r = await fetch(`${api}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: value }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, prompt: value } : x)));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

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
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // 反向联动: 勾选变化立即写回当前联动剧本
      syncScript(next);
      return next;
    });
  };

  // 本库类型 -> 剧本表字段名
  const scriptFieldOf = (): string => {
    const type = api.split("/").filter(Boolean).pop();
    return type === "characters" ? "character_ids" : type === "scenes" ? "scene_ids" : "product_ids";
  };

  /** 反向联动: 勾选变化写回当前选中剧本的物料 ids(选择其他剧本/取消时跳过) */
  const syncScript = (ids: number[]): void => {
    const sid = activeScriptRef.current;
    if (!sid) return;
    fetch(`/api/scripts/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [scriptFieldOf()]: ids }),
    })
      .then((r) => r.json())
      .then((j) => { if (j.ok) window.dispatchEvent(new Event("scripts-changed")); })
      .catch(() => { /* 静默 */ });
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
      title: "名称", dataIndex: "name", key: "name", width: 96,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft"><span style={{ fontSize: 13 }}>{v}</span></Tooltip>
      ),
    },
    {
      title: "图片", key: "images", width: 96,
      render: (_v, rec) => {
        const imgs = rec.images || [];
        return (
          <div
            onClick={(e) => { e.stopPropagation(); setGallery({ open: true, record: rec }); }}
            title={imgs.length ? "点击管理图片" : "点击添加图片"}
            style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", minHeight: 28, flexWrap: "wrap" }}
          >
            {imgs.slice(0, 3).map((img) => (
              <img
                key={img.id}
                src={img.path}
                alt={img.name}
                style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", border: "1px solid #eee", display: "block" }}
              />
            ))}
            {imgs.length > 3 && <span style={{ fontSize: 11, color: "#999" }}>+{imgs.length - 3}</span>}
            {imgs.length === 0 && <span style={{ fontSize: 15, color: "#ccc", lineHeight: "28px" }}>＋</span>}
          </div>
        );
      },
    },
    ...(showIdentity
      ? [{
          title: identityLabel, dataIndex: "identity", key: "identity", width: 110,
          render: (v: string[], rec) => {
            if (!Array.isArray(v) || !v.length) return <span style={{ fontSize: 12, color: "#ccc" }}>—</span>;
            // 下拉选择器: 选中的身份(默认)存库并放到数组首位
            return (
              <div onClick={(e) => e.stopPropagation()}>
                <Select
                  size="small"
                  variant="borderless"
                  value={v[0]}
                  options={v.map((t) => ({
                    value: t,
                    label: (
                      <div
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); removeIdentity(rec, t); }}
                        title="右键删除该身份"
                      >
                        {t}
                      </div>
                    ),
                  }))}
                  onChange={(val) => void setDefaultIdentity(rec.id, v, val)}
                  onOpenChange={(open) => { if (!open) { setIdAdding(null); setNewIdText(""); } }}
                  style={{ width: "100%", fontSize: 12 }}
                  popupMatchSelectWidth={false}
                  popupRender={(menu) => (
                    <>
                      {menu}
                      <div
                        style={{ borderTop: "1px solid #f0f0f0", padding: "4px 6px" }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {idAdding === rec.id ? (
                          <Input
                            size="small"
                            autoFocus
                            value={newIdText}
                            onChange={(e) => setNewIdText(e.target.value)}
                            onPressEnter={() => void addIdentity(rec, newIdText)}
                            placeholder="输入新身份后回车"
                          />
                        ) : (
                          <div
                            className="conv-menu-item"
                            onClick={() => { setIdAdding(rec.id); setNewIdText(""); }}
                            style={{ fontSize: 12, color: "#666", cursor: "pointer", padding: "3px 4px", borderRadius: 4 }}
                          >
                            ＋ 新增身份
                          </div>
                        )}
                      </div>
                    </>
                  )}
                />
              </div>
            );
          },
        } as ColumnsType<CardItem>[number]]
      : []),
    {
      title: "提示词", dataIndex: "prompt", key: "prompt",
      ellipsis: true,
      render: (v: string, rec) => {
        return (
          <Tooltip title={v || "点击编辑"} placement="leftTop">
            <span
              onClick={(e) => { e.stopPropagation(); setEditPrompt({ open: true, id: rec.id, value: v || "" }); }}
              style={{ fontSize: 12, color: v ? "#888" : "#ccc", cursor: "text" }}
            >
              {v || "—"}
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div
      style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid #e5e5e5", background: "#fff", overflow: "hidden" }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* 拖拽悬停高亮遮罩 */}
      {dragging && (
        <div style={{ position: "absolute", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.06)", border: "2px dashed #000", borderRadius: 12, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 14 }}>
          松开添加文件夹（自动识别并导入）
        </div>
      )}
      {/* 模块标题行: 标题 + 搜索/批量删除/新增(全在右侧) */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderBottom: "1px solid #eee" }}>
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
        {importing && <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>导入中…</span>}
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
          <Button
            danger
            disabled={!selected.length}
            title="批量删除"
            style={{ width: 24, height: 24, minWidth: 24, padding: 0, border: "none", boxShadow: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <DeleteOutlined style={{ fontSize: 12, display: "block" }} />
          </Button>
        </Popconfirm>
        <Button
          type="primary"
          onClick={openAdd}
          title={`新增${title}`}
          style={{ width: 24, height: 24, minWidth: 24, padding: 0, border: "none", boxShadow: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <PlusOutlined style={{ fontSize: 12, display: "block" }} />
        </Button>
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
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => { setSelected(keys as number[]); syncScript(keys as number[]); } }}
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

      {/* 提示词编辑弹窗(点击提示词列打开) */}
      <Modal open={editPrompt.open} title="编辑提示词" onCancel={() => setEditPrompt((p) => ({ ...p, open: false }))} footer={null} width={520} destroyOnHidden>
        <Input.TextArea
          value={editPrompt.value}
          onChange={(e) => setEditPrompt((p) => ({ ...p, value: e.target.value }))}
          autoSize={{ minRows: 4, maxRows: 10 }}
          placeholder="提示词 / 描述（留空显示 —）"
          style={{ fontSize: 13 }}
        />
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={() => setEditPrompt((p) => ({ ...p, open: false }))}>取消</Button>
          <Button
            type="primary"
            onClick={() => {
              const pid = editPrompt.id;
              const pv = editPrompt.value;
              setEditPrompt((p) => ({ ...p, open: false }));
              void savePrompt(pid, pv);
            }}
          >
            保存
          </Button>
        </div>
      </Modal>

      {/* 图片管理弹窗(点击列表缩略图打开): 增删图片/改名, 确认后统一提交 */}
      <ImageGalleryModal
        open={gallery.open}
        recordId={gallery.record?.id ?? 0}
        recordName={gallery.record?.name ?? ""}
        api={api}
        images={gallery.record?.images || []}
        onCancel={() => setGallery({ open: false, record: null })}
        onSaved={() => { setGallery({ open: false, record: null }); applyFilter(); }}
      />

      {/* 新增弹窗: 手动填写 / 粘贴提示词 / 上传文件或文件夹 */}
      <Modal open={modalOpen} title={`新增${title}`} onCancel={() => { setModalOpen(false); setPickedImgs([]); setPasteContent(""); }} footer={null} width={460} destroyOnHidden>
        <Tabs
          size="small"
          items={[
            {
              key: "manual",
              label: "手动填写",
              children: (
                <>
                  <Form form={form} layout="vertical" style={{ marginTop: 4 }}>
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
                    <Form.Item label="图片（上传添加，可点 ✕ 立即删除）">
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {/* 只展示本次已选/已添加的图片(不是图库全集) */}
                        {pickedImgs.map((pid) => {
                          const img = library.find((x) => x.id === pid);
                          if (!img) return null;
                          return (
                            <div
                              key={img.id}
                              title={img.name || img.description}
                              style={{ position: "relative", width: 52, height: 52, borderRadius: 8, overflow: "hidden", border: "2px solid #000", flexShrink: 0 }}
                            >
                              <img src={img.path} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              {/* 即时删除(从本次选择移除, 立即消失) */}
                              <div
                                onClick={() => { setPickedImgs((prev) => prev.filter((x) => x !== img.id)); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                title="删除"
                                style={{ position: "absolute", top: 0, right: 0, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, lineHeight: "20px", textAlign: "center", cursor: "pointer", zIndex: 2 }}
                              >
                                ✕
                              </div>
                            </div>
                          );
                        })}
                        <div onClick={() => fileRef.current?.click()} style={{ width: 52, height: 52, borderRadius: 8, border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 22, cursor: "pointer", flexShrink: 0 }}>
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
                      {pickedImgs.length > 0 && <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>已选 {pickedImgs.length} 张（✕ 立即删除）</div>}
                    </Form.Item>
                  </Form>
                  <Button type="primary" block onClick={() => void save()}>添加</Button>
                </>
              ),
            },
            {
              key: "paste",
              label: "粘贴提示词",
              children: (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                  <Input.TextArea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder={`粘贴一大段关于该${title.replace("库", "")}的提示词/描述…
AI 会自动识别名称、${identityLabel}标签并整理为提示词入库（无图片也可）`}
                    autoSize={{ minRows: 8, maxRows: 14 }}
                    style={{ fontSize: 13 }}
                  />
                  <Button type="primary" block loading={importing} disabled={!pasteContent.trim()} onClick={() => void callImport(null, pasteContent)}>
                    AI 整理并添加
                  </Button>
                </div>
              ),
            },
            {
              key: "upload",
              label: "上传文件/文件夹",
              children: (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                  <div style={{ border: "1px dashed #ddd", borderRadius: 8, padding: "18px 12px", textAlign: "center", color: "#999", fontSize: 13 }}>
                    支持 txt / md / word(.docx) / 图片
                    <br />（word 内嵌图片会一并提取入库）
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <Button icon={<PaperClipOutlined />} loading={importing} onClick={() => importFilesRef.current?.click()}>选择文件</Button>
                    <Button icon={<FolderOpenOutlined />} loading={importing} onClick={() => importFolderRef.current?.click()}>选择文件夹</Button>
                  </div>
                  <div style={{ fontSize: 12, color: "#bbb", textAlign: "center" }}>也可以直接拖到卡片上</div>
                  <input
                    ref={importFilesRef}
                    type="file"
                    multiple
                    accept=".txt,.md,.docx,.jpg,.jpeg,.png,.gif,.webp"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const fs = Array.from(e.target.files || []);
                      e.target.value = "";
                      if (fs.length) await callImport(fs, "");
                    }}
                  />
                  <input
                    ref={importFolderRef}
                    type="file"
                    multiple
                    // @ts-expect-error webkitdirectory 为浏览器扩展属性
                    webkitdirectory=""
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const fs = Array.from(e.target.files || []);
                      e.target.value = "";
                      if (fs.length) await callImport(fs, "");
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>
</div>
  );
}