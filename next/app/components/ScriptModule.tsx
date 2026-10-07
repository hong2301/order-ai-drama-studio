"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Badge, Button, ConfigProvider, DatePicker, Empty, Form, Input, Modal, Popconfirm, Table, Tabs, Tooltip, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, SearchOutlined, VideoCameraOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import zhCN from "antd/locale/zh_CN";
import type { UploadFile } from "antd/es/upload/interface";
import VideoLibraryModal from "./VideoLibraryModal";

interface Script {
  id: number;
  name: string;
  file_path: string;
  content: string;
  created_at: string;
  updated_at: string;
  character_ids?: string;
  scene_ids?: string;
  product_ids?: string;
  /** 后端附带的物料名称(三库同名已合并, 联动按名称选中) */
  char_names?: string[];
  scene_names?: string[];
  prod_names?: string[];
  resolution?: string;
  duration?: string;
  ratio?: string;
  keywords?: string;
}

const PAGE_SIZE = 10; // 每页条数(滚动到底自动加载下一页)
const ACCEPT_FILES = ".txt,.md,.docx"; // 支持的文件类型

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
  const [videoLibOpen, setVideoLibOpen] = useState(false); // 视频库弹窗
  const [pendingVidCount, setPendingVidCount] = useState(0); // 生成中视频数(视频库徽标)
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null); // 行右键菜单
  const [editPrompt, setEditPrompt] = useState<{ open: boolean; id: number; value: string }>({ open: false, id: 0, value: "" }); // 提示词弹窗编辑
  const [editName, setEditName] = useState<{ open: boolean; id: number; value: string }>({ open: false, id: 0, value: "" });     // 标题弹窗编辑
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

  // 视频库徽标: 生成中任务数量——占位创建/任务完成都会派发 videos-changed 刷新, 另加 20s 兜底轮询
  const refreshPendingVidCount = useCallback((): void => {
    fetch("/api/video/tasks/count")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("count fail"))))
      .then((j: { ok?: boolean; pending?: number }) => { if (j.ok) setPendingVidCount(Number(j.pending) || 0); })
      .catch(() => { /* 静默 */ });
  }, []);
  useEffect(() => {
    refreshPendingVidCount();
    const iv = setInterval(refreshPendingVidCount, 20000);
    window.addEventListener("videos-changed", refreshPendingVidCount);
    return () => { clearInterval(iv); window.removeEventListener("videos-changed", refreshPendingVidCount); };
  }, [refreshPendingVidCount]);

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

  // ---------- 添加: 上传文件(单次, 解析中/完成均有提示) ----------
  const uploadOne = async (f: File): Promise<void> => {
    const key = `script-parse-${Date.now()}`;
    message.loading({ content: `正在添加并解析「${f.name}」…`, key, duration: 0 });
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/scripts/upload", { method: "POST", body: fd });
      const j = (await r.json()) as { detail?: string; ok?: boolean; name?: string; parse?: { ok?: boolean; summary?: string; detail?: string } | null };
      if (!r.ok) throw new Error(j.detail || `上传失败: ${f.name}`);
      if (j.parse?.ok && j.parse.summary) {
        message.success({ content: `添加成功，解析完成: ${j.parse.summary}`, key, duration: 4 });
      } else {
        const why = j.parse && !j.parse.ok ? `（${j.parse.detail || "解析失败"}）` : "";
        message.success({ content: `已添加: ${j.name ?? f.name}${why}`, key, duration: 4 });
      }
      // 刷新剧本库 + 三库(解析出的 人物/场景/产品)
      applyFilter();
      window.dispatchEvent(new Event("scripts-changed"));
    } catch (e) {
      message.error({ content: (e as Error).message, key, duration: 4 });
    }
  };

  // 弹窗内选择文件(一次一个; 确认即关闭弹窗, 后台解析)
  const handlePickerFiles = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    setFileList([]);
    setModalOpen(false); // 确认后弹窗立即关闭
    setSelected([]);
    await uploadOne(f);
  };

  // 模块内直接拖入文件(可多个, 逐个上传解析)
  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    setSelected([]);
    for (const f of files) await uploadOne(f);
  };

  // ---------- 添加: 粘贴提示词(确认即关弹窗, 后台解析) ----------
  const saveText = async (): Promise<void> => {
    let values: { name?: string; content: string };
    try {
      values = await textForm.validateFields();
    } catch { return; }
    const key = `script-parse-${Date.now()}`;
    message.loading({ content: "正在添加并解析剧本…", key, duration: 0 });
    setModalOpen(false); // 确认后弹窗立即关闭
    setSaving(true);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name || "", content: values.content }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean; parse?: { ok?: boolean; summary?: string; detail?: string } | null };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      if (j.parse?.ok && j.parse.summary) {
        message.success({ content: `添加成功，解析完成: ${j.parse.summary}`, key, duration: 4 });
      } else {
        const why = j.parse && !j.parse.ok ? `（${j.parse.detail || "解析失败"}）` : "";
        message.success({ content: `已添加${why}`, key, duration: 4 });
      }
      setSelected([]);
      applyFilter();
      window.dispatchEvent(new Event("scripts-changed"));
    } catch (e) {
      message.error({ content: (e as Error).message, key, duration: 4 });
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
      setSelected((s) => {
        const next = s.filter((x) => x !== id);
        if (next.length !== s.length) dispatchUnlink(); // 删的是联动选中的剧本 → 通知恢复
        return next;
      });
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
      if (!r.ok) throw new Error(j.detail || "删除失败");
      message.success(`已删除 ${j.deleted ?? selected.length} 条`);
      setSelected([]);
      dispatchUnlink(); // 删掉的正是联动选中的剧本 → 通知三库/控制台恢复
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
  /** JSON 数组安全解析 */
  const parseIds = (raw?: string): number[] => {
    try { const a = JSON.parse(raw || "[]") as unknown[]; return a.filter((n): n is number => typeof n === "number"); } catch { return []; }
  };

  /** 派发取消联动(三库/控制台恢复) */
  const dispatchUnlink = (): void => {    setTimeout(
      () => window.dispatchEvent(new CustomEvent("library-link", { detail: { chars: [], scenes: [], prods: [], charNames: [], sceneNames: [], prodNames: [], unlink: true, name: "", scriptId: null } })),
      0,
    );
  };

  /** 单选: 选中指定剧本(派发联动); 传 null 取消选中 */
  const selectOne = (id: number | null): void => {
    if (id === null) {
      setSelected([]);
      dispatchUnlink();
      return;
    }
    const rec = items.find((i) => i.id === id);
    setSelected([id]); // 单选: 覆盖之前的选中
    if (!rec) return;
    // 异步派发, 脱离 React 渲染事件栈(避免"渲染期间更新其他组件"警告)
    const detail = {
      chars: parseIds(rec.character_ids),
      scenes: parseIds(rec.scene_ids),
      prods: parseIds(rec.product_ids),
      // 名称联动: 三库同名记录会合并, 按名称选中更可靠
      charNames: rec.char_names || [],
      sceneNames: rec.scene_names || [],
      prodNames: rec.prod_names || [],
      resolution: rec.resolution || "",
      duration: rec.duration || "",
      ratio: rec.ratio || "",
      prompt: rec.content || "", // 剧本内容即生成提示词(控制台直接使用)
      name: rec.name || "",
      scriptId: rec.id, // 下游反向写回用
    };
    setTimeout(() => window.dispatchEvent(new CustomEvent("library-link", { detail })), 0);
  };

  // 行点击: 单选(一次只能选中一个剧本); 再点已选中的行则取消
  const toggleSelect = (id: number): void => {
    selectOne(selected.includes(id) ? null : id);
  };

  // 右键手动解析剧本(识别人物/场景/产品/清晰度/时长/关键词)
  const parseOne = async (id: number): Promise<void> => {
    setMenu(null);
    // duration:0 → loading 不自动消失(解析可能要几十秒), 完成时用同 key 替换
    const key = `parse-${id}-${Date.now()}`;
    message.loading({ content: "正在解析(可能需要几秒~几十秒)…", key, duration: 0 });
    try {
      const r = await fetch(`/api/scripts/${id}/parse`, { method: "POST" });
      const j = (await r.json()) as { detail?: string; ok?: boolean; summary?: string };
      if (!r.ok) throw new Error(j.detail || "解析失败");
      message.success({ content: `解析完成: ${j.summary || ""}`, key, duration: 3 });
      applyFilter();
    } catch (e) {
      message.error({ content: `解析失败: ${(e as Error).message}`, key, duration: 4 });
    }
  };

  /** 保存剧本标题(只改 name, 不动内容) */
  const saveName = async (): Promise<void> => {
    const pid = editName.id;
    const nv = editName.value.trim();
    if (!nv) { message.warning("标题不能为空"); return; }
    setEditName((p) => ({ ...p, open: false }));
    try {
      const r = await fetch(`/api/scripts/${pid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nv }),   // 只传 name: 内容/物料关联/生成参数均不动
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      setItems((prev) => prev.map((i) => (i.id === pid ? { ...i, name: nv } : i))); // 本地立即更新
      message.success("标题已更新");
      window.dispatchEvent(new Event("scripts-changed"));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<Script> = [
    {
      title: "名称", dataIndex: "name", key: "name",
      ellipsis: true,
      render: (v: string, rec) => {
        let tag = "";
        try {
          const cs = JSON.parse(rec.character_ids || "[]") as number[];
          const ss = JSON.parse(rec.scene_ids || "[]") as number[];
          const ps = JSON.parse(rec.product_ids || "[]") as number[];
          tag = `人物${cs.length}·场景${ss.length}·产品${ps.length}`;
          if (rec.resolution || rec.duration || rec.ratio) {
            tag += `｜${[rec.resolution, rec.ratio, rec.duration ? `${rec.duration}秒` : ""].filter(Boolean).join(" ")}`;
          }
        } catch { /* ignore */ }
        return (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Tooltip title={`${v}（点击可修改标题）`} placement="topLeft">
              <span
                style={{ fontSize: 13, cursor: "text" }}
                onClick={(e) => { e.stopPropagation(); setEditName({ open: true, id: rec.id, value: v || "" }); }}
              >
                {v}
              </span>
            </Tooltip>
            {tag && <span style={{ fontSize: 10, color: "#bbb" }}>{tag}</span>}
          </div>
        );
      },
    },
    {
      title: "提示词", dataIndex: "content", key: "content",
      ellipsis: true,
      render: (v: string, rec) => {
        const text = (v || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        return (
          <Tooltip
            placement="leftTop"
            styles={{ container: { maxWidth: 420 } }}
            title={
              <div style={{ maxHeight: 280, overflowY: "auto", whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6 }}>
                {text || "无"}
              </div>
            }
          >
            <span
              onClick={(e) => { e.stopPropagation(); setEditPrompt({ open: true, id: rec.id, value: v || "" }); }}
              style={{ fontSize: 12, color: text ? "#888" : "#ccc", cursor: "text" }}
            >
              {text || "—"}
            </span>
          </Tooltip>
        );
      },
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
            className="clickable-table"
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
              onChange: (keys) => {
                // 单选: 只保留最后勾选的一项(选中新的自动取消旧的; 取消则传 null)
                const next = (keys as number[]).slice(-1);
                selectOne(next.length ? next[0] : null);
              },
            }}
          />
        </ConfigProvider>
        {loadingMore && <div style={{ textAlign: "center", padding: 10, fontSize: 12, color: "#bbb" }}>加载中…</div>}
        {!hasMore && items.length > 0 && <div style={{ textAlign: "center", padding: 10, fontSize: 12, color: "#ccc" }}>没有更多了</div>}
      </div>

      {/* 底部工具栏: 批量删除(常驻, 未选中置灰) + 新增(靠右) */}
      <div style={{ borderTop: "1px solid #eee", padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <Popconfirm
          title={`确认删除选中的剧本“${items.find((i) => i.id === selected[0])?.name || ""}”？`}
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
            删除{selected.length > 0 ? " (1)" : ""}
          </Button>
        </Popconfirm>
        {/* 视频库(在删除按钮右边, size 一致); 徽标=当前生成中任务数(动态) */}
        <Badge count={pendingVidCount} size="small" color="#ff4d4f" overflowCount={99} offset={[-6, 2]}>
          <Button icon={<VideoCameraOutlined />} onClick={() => setVideoLibOpen(true)} title="视频库" style={{ height: 40, display: "inline-flex", alignItems: "center" }}>
            视频库
          </Button>
        </Badge>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openAdd}
          title="添加剧本"
          style={{ width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, fontSize: 16 }}
        />
      </div>

      {/* 行右键菜单: 解析 / 删除 */}
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
              onClick={() => { const id = menu.id; setMenu(null); void parseOne(id); }}
              style={{ padding: "8px 14px", fontSize: 13, color: "#111", cursor: "pointer" }}
            >
              解析
            </div>
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

      {/* 视频库弹窗 */}
      <VideoLibraryModal open={videoLibOpen} onClose={() => setVideoLibOpen(false)} />

      {/* 标题弹窗编辑(点击名称列打开) */}
      <Modal open={editName.open} title="修改标题" onCancel={() => setEditName((p) => ({ ...p, open: false }))} footer={null} width={460} destroyOnHidden>
        <Input
          value={editName.value}
          onChange={(e) => setEditName((p) => ({ ...p, value: e.target.value }))}
          onPressEnter={() => void saveName()}
          placeholder="剧本标题…"
          maxLength={80}
          showCount
        />
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={() => setEditName((p) => ({ ...p, open: false }))}>取消</Button>
          <Button type="primary" onClick={() => void saveName()}>保存</Button>
        </div>
      </Modal>

      {/* 提示词弹窗编辑(点击提示词列打开) */}
      <Modal open={editPrompt.open} title="编辑提示词" onCancel={() => setEditPrompt((p) => ({ ...p, open: false }))} footer={null} width={560} destroyOnHidden>
        <Input.TextArea
          value={editPrompt.value}
          onChange={(e) => setEditPrompt((p) => ({ ...p, value: e.target.value }))}
          autoSize={{ minRows: 6, maxRows: 14 }}
          placeholder="剧本内容 / 提示词…"
          style={{ fontSize: 13, lineHeight: 1.7 }}
        />
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={() => setEditPrompt((p) => ({ ...p, open: false }))}>取消</Button>
          <Button
            type="primary"
            onClick={() => {
              const pid = editPrompt.id;
              const pv = editPrompt.value;
              setEditPrompt((p) => ({ ...p, open: false }));
              const rec = items.find((i) => i.id === pid);
              void (async () => {
                try {
                  const r = await fetch(`/api/scripts/${pid}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: rec?.name || "", file_path: rec?.file_path || "", content: pv }),
                  });
                  const j = (await r.json()) as { detail?: string; ok?: boolean };
                  if (!r.ok) throw new Error(j.detail || "保存失败");
                  // 先本地更新: 列表刷新是异步的, 不先更新的话用户保存后立刻再点开看到的还是旧内容
                  setItems((prev) => prev.map((i) => (i.id === pid ? { ...i, content: pv } : i)));
                  message.success("已保存");
                  window.dispatchEvent(new Event("scripts-changed")); // 再拉一次, 同步名称等派生字段
                } catch (e) {
                  message.error((e as Error).message);
                }
              })();
            }}
          >
            保存
          </Button>
        </div>
      </Modal>

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
                  accept={ACCEPT_FILES}
                  fileList={fileList}
                  beforeUpload={(_f, files) => { void handlePickerFiles(files); return false; }}
                  onChange={({ fileList: fl }) => setFileList(fl)}
                  style={{ padding: "6px 0" }}
                >
                  <p style={{ fontSize: 14, color: "#888", margin: 0 }}>点击或拖入文件</p>
                  <p style={{ fontSize: 12, color: "#bbb", margin: "6px 0 0" }}>支持 .txt / .md / .docx（word 图片会一并提取）</p>
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