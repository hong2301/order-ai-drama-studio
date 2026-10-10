"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, Dropdown, Input, Modal, Spin } from "antd";
import { FileOutlined, FilePdfOutlined, FileTextOutlined, FileWordOutlined, LoadingOutlined, PaperClipOutlined, SendOutlined, UnorderedListOutlined } from "@ant-design/icons";

interface Msg { role: "user" | "assistant"; content: string; images?: string[] }
interface Att { name: string; url: string }
interface Conv { id: number; title: string; updatedAt: number; messages: Msg[] }
// 全模型(对话模块切换用; 服务端已过滤为可输入 图片/视频/文本 的多模态对话模型, 含综合费用/百万token)
interface ArkModel { id: string; label: string; price: number }

const MAX_ATTACH = 9; // 最多 9 个附件

/** 附件文件类型占位: 按扩展名返回图标+颜色 */
function fileIconOf(name: string): { icon: React.ReactNode; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["doc", "docx"].includes(ext)) return { icon: <FileWordOutlined />, color: "#2b579a" };
  if (["pdf"].includes(ext)) return { icon: <FilePdfOutlined />, color: "#e5484d" };
  if (["xls", "xlsx", "csv"].includes(ext)) return { icon: <FileTextOutlined />, color: "#217346" };
  if (["txt", "md", "json", "log"].includes(ext)) return { icon: <FileTextOutlined />, color: "var(--text-2)" };
  return { icon: <FileOutlined />, color: "var(--text-4)" };
}
const LEGACY_KEY = "aivs:chat:v1"; // 旧单会话历史(迁移用)
const CONVS_KEY = "aivs:convs:v1"; // 多会话列表(标题/时间/消息)

/** 相对/绝对时间显示: 刚刚 → N分钟前 → N小时前 → 年月日 时:分(不带秒) */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 会话标题: 取第一条用户消息前 18 字(无消息时"新对话") */
function deriveTitle(msgs: Msg[]): string {
  const first = msgs.find((m) => m.role === "user");
  const t = (first?.content || "").trim().replace(/\s+/g, " ");
  return t ? (t.length > 18 ? `${t.slice(0, 18)}…` : t) : "新对话";
}

/** 旧版本 localStorage 会话数据: 首次加载时迁移到数据库, 迁移后清除(不再使用 localStorage) */
function readLegacyConvs(): Conv[] {
  try {
    const raw = localStorage.getItem(CONVS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { convs?: { title?: unknown; updatedAt?: unknown; messages?: unknown }[] };
      localStorage.removeItem(CONVS_KEY);
      const list = Array.isArray(d?.convs) ? d.convs : [];
      const out = list
        .filter((c) => Array.isArray(c.messages) && (c.messages as Msg[]).length > 0)
        .map((c) => ({
          id: 0,
          title: typeof c.title === "string" && c.title ? c.title : "新对话",
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
          messages: c.messages as Msg[],
        }));
      if (out.length) return out;
    }
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) {
      localStorage.removeItem(LEGACY_KEY);
      const arr = JSON.parse(old) as unknown;
      if (Array.isArray(arr) && arr.length) {
        const msgs = arr.filter((m): m is Msg => !!m && ((m as Msg).role === "user" || (m as Msg).role === "assistant") && typeof (m as Msg).content === "string");
        if (msgs.length) return [{ id: 0, title: deriveTitle(msgs), updatedAt: Date.now(), messages: msgs.slice(-50) }];
      }
    }
  } catch { /* ignore */ }
  return [];
}

/** AI 对话模块(第一个模块, 无标题): 对话区 + 底部一体输入框(附件/发送) */
export default function ChatModule() {
  const { message } = AntApp.useApp(); // 上下文 message(消费动态主题), 替代静态 message
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [atts, setAtts] = useState<Att[]>([]);
  const [preview, setPreview] = useState<Att | null>(null); // 图片点击预览(带文件名)
  const [uploading, setUploading] = useState(0);
  const [loading, setLoading] = useState(true); // 历史是否已恢复(避免首屏闪历史)
  const [convs, setConvs] = useState<Conv[]>([]);       // 全部会话(消息按需加载)
  const [convId, setConvId] = useState<number | null>(null); // 当前会话 id(数据库自增)
  const [listOpen, setListOpen] = useState(false);      // 会话列表面板是否展开
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null); // 右键菜单
  const skipSaveRef = useRef(false); // 切换/新建会话期间跳过自动保存(避免把空消息写回去)
  // 模型切换: 服务端已适配好的多模态对话模型
  const [arkModels, setArkModels] = useState<ArkModel[]>([]);
  const [chatModel, setChatModel] = useState<string | null>(null); // null = 用服务端默认模型
  const [modelOpen, setModelOpen] = useState(false); // 模型下拉面板开关
  const [loadingModels, setLoadingModels] = useState(false); // 模型加载中
  const videoPollRef = useRef<Record<string, ReturnType<typeof setInterval>>>({}); // AI 发起视频任务的轮询
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 首次加载: 旧 localStorage 迁移入库 + 拉会话列表 + 打开最近会话(消息按需 GET)
  useEffect(() => {
    void (async () => {
      try {
        // 1) 旧 localStorage 数据一次性迁移到数据库(已读即清)
        for (const c of readLegacyConvs()) {
          try {
            const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: c.title }) });
            const j = (await r.json()) as { id?: number };
            if (j.id && c.messages.length) {
              await fetch(`/api/conversations/${j.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: c.messages }) });
            }
          } catch { /* 单条迁移失败不影响 */ }
        }
        // 2) 会话列表(最近在前)
        const r = await fetch("/api/conversations");
        const j = (await r.json()) as { items?: { id: number; title: string; updated_at: string }[] };
        let list = (j.items || []).map((x) => ({ id: x.id, title: x.title || "新对话", updatedAt: Date.parse(x.updated_at) || Date.now(), messages: [] as Msg[] }));
        let cur: Conv | null = list[0] || null;
        // 3) 无任何会话 → 新建一个空的
        if (!cur) {
          const cr = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
          const cj = (await cr.json()) as { id?: number; title?: string };
          cur = { id: cj.id || 0, title: cj.title || "新对话", updatedAt: Date.now(), messages: [] };
          list = [cur];
        }
        // 4) 打开最近会话并加载其消息
        if (cur) {
          const dr = await fetch(`/api/conversations/${cur.id}`);
          const dj = (await dr.json()) as { messages?: Msg[] };
          cur = { ...cur, messages: dj.messages || [] };
          list = list.map((x) => (x.id === cur!.id ? cur! : x));
          setMessages(cur.messages);
          setConvId(cur.id);
        }
        setConvs(list);
      } catch { /* 加载失败: 前端仍可新建(空态) */ }
      finally { setLoading(false); }
    })();
  }, []);

  // 加载已适配的多模态对话模型(自动探测已开通; fresh=1 重新检测)
  const loadArkModels = useCallback((fresh = false): void => {
    setLoadingModels(true);
    fetch(`/api/models${fresh ? "?fresh=1" : ""}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.detail);
        setArkModels((j.models || []) as ArkModel[]);
        // 重新检测后切回服务端默认模型(或保持现有选择若仍在列表)
        if (fresh && j.default && (j.models || []).some((m: ArkModel) => m.id === j.default)) setChatModel(j.default as string);
      })
      .catch((e) => message.error(`加载模型失败: ${(e as Error).message}`))
      .finally(() => setLoadingModels(false));
  }, [message]);

  useEffect(() => { loadArkModels(false); }, [loadArkModels]);

  // 当前选中模型的展示名
  const curChatModel = arkModels.find((m) => m.id === chatModel) || null;

  /** 切换对话模型: 本地使用 + 同步到服务端(剧本解析/剧情适配共用同一模型) */
  const selectChatModel = (id: string): void => {
    void fetch("/api/models/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: id }),
    }).catch(() => { /* 静默 */ });
  };

  // 当前会话消息变化: 自动保存到数据库(标题: 非"新对话"则保留, 否则取首条用户消息)
  useEffect(() => {
    if (loading || !convId || skipSaveRef.current) return;
    setConvs((prev) => {
      const next = prev.map((c) =>
        c.id === convId
          ? { ...c, messages, title: c.title !== "新对话" ? c.title : deriveTitle(messages) }
          : c,
      );
      const cur = next.find((c) => c.id === convId);
      if (cur) {
        void fetch(`/api/conversations/${convId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: cur.title, messages: cur.messages }),
        }).catch(() => { /* 静默 */ });
      }
      return next;
    });
  }, [messages, loading, convId]);

  // 更新当前会话的最后对话时间(仅刷新 updated_at)
  const touchConv = (): void => {
    if (!convId) return;
    setConvs((prev) => prev.map((c) => (c.id === convId ? { ...c, updatedAt: Date.now() } : c)));
    void fetch(`/api/conversations/${convId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => { /* 静默 */ });
  };

  // 切换到某个历史会话(消息从数据库加载)
  const openConv = (id: number): void => {
    if (id === convId) { setListOpen(false); return; }
    skipSaveRef.current = true;
    setConvId(id);
    setMessages([]);
    setAtts([]);
    setListOpen(false);
    // 加载该会话的消息(成功后恢复自动保存)
    void fetch(`/api/conversations/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载失败"))))
      .then((j: { messages?: Msg[] }) => {
        const ms = j.messages || [];
        setMessages(ms);
        setConvs((prev) => prev.map((x) => (x.id === id ? { ...x, messages: ms } : x)));
      })
      .catch(() => { /* 静默 */ })
      .finally(() => { setTimeout(() => { skipSaveRef.current = false; }, 0); });
  };

  // 新建会话(数据库创建; 服务端会清理无消息空会话)
  const newConv = (): void => {
    void (async () => {
      try {
        const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const j = (await r.json()) as { ok?: boolean; id?: number; title?: string };
        if (!j.ok || !j.id) return;
        const c: Conv = { id: j.id, title: j.title || "新对话", updatedAt: Date.now(), messages: [] };
        skipSaveRef.current = true;
        setConvs((prev) => [c, ...prev.filter((x) => x.messages.length > 0 || x.id === convId)]);
        setConvId(c.id);
        setMessages([]);
        setAtts([]);
        setListOpen(false);
        setTimeout(() => { skipSaveRef.current = false; }, 0);
      } catch { /* 静默 */ }
    })();
  };

  // 删除会话(右键菜单); 删当前会话则切到最近一个, 全删光则新建空会话
  const delConv = (id: number): void => {
    setMenu(null);
    void fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => { /* 静默 */ });
    const rest = convs.filter((c) => c.id !== id);
    if (rest.length === 0) { newConv(); return; }
    if (id === convId) {
      openConv(rest[0].id);
    }
    setConvs(rest);
  };

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // ---------- 附件上传(最多 9 个文件) ----------
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    const room = MAX_ATTACH - atts.length;
    if (room <= 0) {
      message.warning(`最多上传 ${MAX_ATTACH} 个文件`);
      return;
    }
    const picked = list.slice(0, room);
    if (list.length > room) message.warning(`最多 ${MAX_ATTACH} 张，已截取前 ${room} 张`);
    setUploading((n) => n + picked.length);
    for (const f of picked) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("folder", "chat");
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const j = (await r.json()) as { ok?: boolean; msg?: string; url?: string; name?: string };
        if (j.ok && j.url) setAtts((prev) => [...prev, { name: j.name || f.name, url: j.url as string }]);
        else message.error(j.msg || `上传失败: ${f.name}`);
      } catch {
        message.error(`上传失败: ${f.name}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  /** AI 工具发起的视频任务: 后台轮询直到终态(完成 → 提示 + 刷新视频库) */
  const watchVideoTask = (id: string): void => {
    if (videoPollRef.current[id]) return;
    let fail = 0;
    videoPollRef.current[id] = setInterval(async () => {
      try {
        const r = await fetch(`/api/video/tasks/${id}`);
        const j = (await r.json()) as { ok?: boolean; task?: { status?: string; error?: string | null } };
        if (!j.ok || !j.task) throw Object.assign(new Error("任务不存在"), { status: 404 });
        fail = 0;
        const st = j.task.status;
        if (st === "succeeded") {
          const iv = videoPollRef.current[id];
          if (iv) { clearInterval(iv); delete videoPollRef.current[id]; }
          message.success("视频生成完成，已存入视频库");
          window.dispatchEvent(new Event("videos-changed"));
        } else if (st === "failed" || st === "cancelled") {
          const iv = videoPollRef.current[id];
          if (iv) { clearInterval(iv); delete videoPollRef.current[id]; }
          message.warning(`视频生成${st === "cancelled" ? "已取消" : "失败"}${j.task.error ? `：${j.task.error}` : ""}（可在视频库右键删除该记录）`);
        }
      } catch {
        // 心跳中断: 连续 3 次失败才停止并提示(容忍短暂抖动)
        fail += 1;
        if (fail >= 3) {
          const iv = videoPollRef.current[id];
          if (iv) { clearInterval(iv); delete videoPollRef.current[id]; }
          message.warning("视频任务状态心跳中断，已停止监听（可打开视频库查看或右键删除）");
          window.dispatchEvent(new Event("videos-changed"));
        }
      }
    }, 5000);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const images = atts.map((a) => a.url);
    setMessages((m) => [...m, { role: "user", content: text, images }]);
    setInput("");
    setAtts([]); // 发送后清空附件预览(图片已随消息一起进对话区)
    setSending(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, images, messages, ...(chatModel ? { model: chatModel } : {}) }),
      });
      const j = (await r.json()) as { detail?: string; reply?: string; scriptsChanged?: boolean; videoTaskIds?: string[] };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setMessages((m) => [...m, { role: "assistant", content: j.reply || "" }]);
      // AI 通过工具新增了剧本 → 通知剧本模块刷新
      if (j.scriptsChanged) window.dispatchEvent(new CustomEvent("scripts-changed"));
      // AI 通过工具发起的视频生成 → 进入后台轮询, 完成后提示 + 视频库刷新
      if (j.videoTaskIds?.length) {
        message.loading("视频生成中，完成后自动存入视频库…", 2);
        for (const tid of j.videoTaskIds) watchVideoTask(tid);
      }
    } catch (e) {
      message.error((e as Error).message);
      setMessages((m) => [...m, { role: "assistant", content: `(调用失败) ${(e as Error).message}` }]);
    } finally {
      setSending(false);
      touchConv(); // 本轮对话结束(成功或失败), 记为最后对话时间
    }
  };

  // 会话列表展示数据(过滤空会话, 最近在前)
  const shownConvs = [...convs].filter((c) => c.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt);
  // 列表高度动态: 最小 3 行, 最多 10 行, 超出滚动(标题 ~34 + 行 x38 + 底部新对话 ~41)
  const ROW = 38, TITLE = 34, NEWBTN = 41;
  const rows = Math.min(10, Math.max(3, shownConvs.length));
  const listHeight = TITLE + rows * ROW + NEWBTN;

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 380, display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid var(--border-1)", background: "var(--bg-card)", overflow: "hidden" }}>
      {/* 左上角浮动层: 会话列表按钮/面板(固定在模块左上角, 不随对话内容滚动) */}
        {/* 点击遮罩: 收起会话列表 */}
        {listOpen && <div onClick={() => setListOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 13, background: "transparent" }} />}
        {/* 圆形列表按钮 ⇄ 矩形会话列表(同一元素形变) */}
        <div
          onClick={listOpen ? undefined : () => setListOpen(true)}
          title={listOpen ? undefined : "对话列表"}
          style={{
            position: "absolute", top: 8, left: 8, zIndex: 20,
            width: listOpen ? 320 : 36,
            height: listOpen ? listHeight : 36,
            borderRadius: listOpen ? 12 : "50%",
            background: "var(--bg-card)",
            border: "1px solid var(--border-1)",
            boxShadow: listOpen ? "0 4px 20px rgba(0,0,0,0.12)" : "0 1px 2px rgba(0,0,0,0.04)",
            overflow: "hidden",
            display: "flex", flexDirection: "column",
            cursor: listOpen ? "default" : "pointer",
            transition: "width .28s cubic-bezier(.4,0,.2,1), height .28s cubic-bezier(.4,0,.2,1), border-radius .28s cubic-bezier(.4,0,.2,1), box-shadow .28s",
          }}
        >
          {/* 收起态: 居中列表图标(展开时淡出; flex 居中避免基线偏移) */}
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: listOpen ? 0 : 1, transition: "opacity .12s", pointerEvents: "none" }}>
            <UnorderedListOutlined style={{ fontSize: 14, color: "var(--text-3)", display: "block" }} />
          </span>
          {/* 展开态: 标题 + 会话列表(形变后淡入, 高 3~10 行动态) */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", opacity: listOpen ? 1 : 0, transition: "opacity .2s .1s" }}>
            {/* 标题栏(固定在顶部) */}
            <div style={{ flexShrink: 0, height: TITLE, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 12, color: "var(--text-4)", borderBottom: "1px solid var(--border-3)" }}>
              对话列表
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {shownConvs.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: "var(--text-5)", textAlign: "center" }}>暂无对话</div>
              )}
              {shownConvs.map((c) => (
                <div
                  key={c.id}
                  className="conv-item"
                  onClick={() => openConv(c.id)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: c.id }); }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--border-3)", flexShrink: 0, background: c.id === convId ? "var(--bg-track)" : undefined }}
                >
                  <span style={{ flex: 1, fontSize: 13, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "新对话"}</span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-5)" }}>{fmtTime(c.updatedAt)}</span>
                </div>
              ))}
            </div>
            <div onClick={newConv} className="conv-new" style={{ flexShrink: 0, height: NEWBTN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-1)", cursor: "pointer", borderTop: "1px solid var(--border-3)", userSelect: "none" }}>
              ＋ 新对话
            </div>
          </div>
        </div>
      {/* 对话区 */}
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "52px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && !sending && (
          <div style={{ color: "var(--text-5)", fontSize: 13, textAlign: "center", marginTop: 48 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🎬</div>
            你好，我是 AI 视频工坊助手
            <br />
            可附带图片一起提问（最多 9 个）
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div
              style={{
                maxWidth: "85%", padding: "8px 12px", borderRadius: 12,
                fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                background: m.role === "user" ? "var(--bg-bubble-me)" : "var(--bg-bubble-other)",
                color: m.role === "user" ? "var(--text-bubble-me)" : "var(--text-bubble-other)",
                borderTopRightRadius: m.role === "user" ? 4 : 12,
                borderTopLeftRadius: m.role === "user" ? 12 : 4,
              }}
            >
              {m.content}
              {/* 消息携带的图片/文件(图片缩略; 文件按类型占位, 可点击打开) */}
              {m.images && m.images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {m.images.map((u) => {
                    const isImg = /\.(jpe?g|png|gif|webp)$/i.test(u);
                    const fname = u.split("/").pop() || u;
                    if (isImg) {
                      return (
                        <img
                          key={u} src={u} alt="附件图片"
                          style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)", display: "block" }}
                        />
                      );
                    }
                    const fi = fileIconOf(fname);
                    return (
                      <div
                        key={u}
                        onClick={() => window.open(u, "_blank")}
                        title={`打开 ${fname}`}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 8, background: "rgba(0,0,0,0.06)", cursor: "pointer", fontSize: 12, color: "var(--text-2)", maxWidth: 170 }}
                      >
                        <span style={{ fontSize: 15, lineHeight: 1, color: fi.color, flexShrink: 0 }}>{fi.icon}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fname}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <div style={{ color: "var(--text-4)", fontSize: 12, paddingLeft: 2 }}>正在思考…</div>}
      </div>

      {/* 底部输入区(模块整体的一部分, 不再套独立卡片边框 —— 一体感) */}
      <div className="chat-input-wrap" style={{ borderTop: "1px solid var(--border-2)", padding: 10, background: "var(--bg-card)" }}>
          {/* 附件缩略展示 */}
          {(atts.length > 0 || uploading > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 8 }}>
              {atts.map((a) => {
                const isImg = /\.(jpe?g|png|gif|webp)$/i.test(a.url);
                return (
                  <div
                    key={a.url}
                    className="att-item"
                    title={isImg ? "点击预览" : `打开 ${a.name}`}
                    onClick={() => {
                      if (isImg) setPreview(a);
                      else window.open(a.url, "_blank");
                    }}
                    style={{ position: "relative", width: 56, height: 44, borderRadius: 8, border: "1px solid var(--border-2)", flexShrink: 0, cursor: "pointer" }}
                  >
                    {isImg ? (
                      <img src={a.url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 7 }} />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 3, background: "var(--bg-subtle)", padding: "3px 4px" }}>
                        <span style={{ fontSize: 16, lineHeight: 1, color: fileIconOf(a.name).color }}>{fileIconOf(a.name).icon}</span>
                        <span style={{ fontSize: 9, lineHeight: 1.1, maxWidth: 52, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-2)" }}>{a.name}</span>
                      </div>
                    )}
                    <span
                      className="att-del"
                      onClick={(e) => { e.stopPropagation(); setAtts((prev) => prev.filter((x) => x.url !== a.url)); }}
                      title="移除"
                      style={{
                        position: "absolute", top: -6, right: -6, width: 16, height: 16,
                        borderRadius: "50%", background: "#ff4d4f", color: "#fff",
                        fontSize: 11, lineHeight: "14px", textAlign: "center", cursor: "pointer",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)", zIndex: 9,
                      }}
                    >
                      ×
                    </span>
                  </div>
                );
              })}
              {uploading > 0 && (
                <div style={{ width: 44, height: 44, borderRadius: 8, border: "1px dashed var(--border-4)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-5)", fontSize: 11 }}>
                  {uploading}
                </div>
              )}
            </div>
          )}

          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="输入消息…（Shift+Enter 换行）"
            autoSize={{ minRows: 1, maxRows: 5 }}
            variant="borderless"
            style={{ fontSize: 13, lineHeight: 1.7, resize: "none", padding: "4px 0" }}
          />

          {/* 工具栏: 模型切换(左) + 附件 + 发送(右) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="*/*"
              style={{ display: "none" }}
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Dropdown
              open={modelOpen}
              onOpenChange={(o) => setModelOpen(o)}
              trigger={["click"]}
              popupRender={() => (
                <div style={{ width: 300, background: "var(--bg-card)", borderRadius: 10, border: "1px solid var(--border-1)", boxShadow: "0 4px 20px rgba(0,0,0,0.14)", overflow: "hidden" }}>
                  {/* 模型列表(服务端已适配为可看图/视频/文本的对话模型) */}
                  <div style={{ maxHeight: 260, overflowY: "auto", padding: 4 }}>
                    {loadingModels ? (
                      <div style={{ padding: 18, textAlign: "center", color: "var(--text-4)", fontSize: 12 }}>
                        <Spin size="small" style={{ marginRight: 6 }} />加载中…
                      </div>
                    ) : arkModels.length === 0 ? (
                      <div style={{ padding: 16, textAlign: "center", color: "var(--text-5)", fontSize: 12 }}>暂无已适配模型</div>
                    ) : (
                      arkModels.map((m) => (
                        <div
                          key={m.id}
                          onClick={() => { setChatModel(m.id); setModelOpen(false); void selectChatModel(m.id); }}
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                            padding: "7px 10px", fontSize: 13, cursor: "pointer", borderRadius: 6,
                            color: m.id === chatModel ? "var(--text-1)" : "var(--text-2)", background: m.id === chatModel ? "var(--bg-track)" : undefined,
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.label}</span>
                          <span style={{ fontSize: 11, color: "var(--text-4)", flexShrink: 0 }}>¥{m.price}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {/* 手动重新检测(强制重探方舟已开通模型) */}
                  <div
                    style={{ borderTop: "1px solid var(--border-3)", padding: "6px 10px", fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}
                    onClick={() => { void loadArkModels(true); }}
                  >
                    🔄 重新检测对话模型
                  </div>
                </div>
              )}
            >
              <Button
                size="large"
                style={{ height: 40, maxWidth: 180, display: "inline-flex", alignItems: "center", overflow: "hidden" }}
                title={curChatModel ? curChatModel.label : "切换模型"}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {curChatModel ? curChatModel.label : "切换模型"}
                </span>
              </Button>
            </Dropdown>
            <div style={{ flex: 1 }} />
            <Button
              type="default"
              shape="circle"
              size="large"
              onClick={() => fileRef.current?.click()}
              title="上传附件（最多 9 个）"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            >
              <PaperClipOutlined style={{ display: "block", lineHeight: 0 }} />
            </Button>
            <Button
              type="primary"
              shape="circle"
              size="large"
              disabled={!input.trim()}
              onClick={send}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            >
              {sending ? (
                <LoadingOutlined spin style={{ display: "block", lineHeight: 0, color: "#fff", fontSize: 15 }} />
              ) : (
                <SendOutlined style={{ display: "block", lineHeight: 0 }} />
              )}
            </Button>
          </div>
      </div>

      {/* 会话右键菜单: 删除 */}
      {menu && (
        <>
          <div
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
            style={{ position: "fixed", inset: 0, zIndex: 30 }}
          />
          <div style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 31, minWidth: 96, background: "var(--bg-card)", border: "1px solid var(--border-2)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden" }}>
            <div className="conv-menu-item" onClick={() => delConv(menu.id)} style={{ padding: "8px 14px", fontSize: 13, color: "#ff4d4f", cursor: "pointer" }}>
              删除
            </div>
          </div>
        </>
      )}

      {/* 图片点击预览: 弹窗标题显示文件名 */}
      <Modal open={!!preview} footer={null} closable onCancel={() => setPreview(null)} width={800} style={{ top: 30 }} title={preview?.name}>
        {preview && <img src={preview.url} alt={preview.name} style={{ width: "100%", display: "block", borderRadius: 4 }} />}
      </Modal>
    </div>
  );
}