"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, message } from "antd";
import { PaperClipOutlined, SendOutlined, UnorderedListOutlined } from "@ant-design/icons";

interface Msg { role: "user" | "assistant"; content: string; images?: string[] }
interface Att { name: string; url: string }
interface Conv { id: string; title: string; updatedAt: number; messages: Msg[] }

const MAX_ATTACH = 9; // 最多 9 个附件
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

/** 加载全部会话(含旧单会话历史迁移) */
function loadConvs(): { convs: Conv[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(CONVS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { convs?: Conv[]; activeId?: string | null };
      if (d && Array.isArray(d.convs)) return { convs: d.convs, activeId: d.activeId ?? null };
    }
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) {
      const arr = JSON.parse(old) as unknown;
      if (Array.isArray(arr) && arr.length) {
        const msgs = arr.filter((m): m is Msg => !!m && ((m as Msg).role === "user" || (m as Msg).role === "assistant") && typeof (m as Msg).content === "string");
        const id = `c_${Date.now()}_old`;
        localStorage.removeItem(LEGACY_KEY);
        return { convs: [{ id, title: deriveTitle(msgs), updatedAt: Date.now(), messages: msgs.slice(-50) }], activeId: id };
      }
    }
  } catch { /* ignore */ }
  return { convs: [], activeId: null };
}
function saveConvs(convs: Conv[], activeId: string | null): void {
  try {
    // 空会话不入库(仅当前会话例外, 保证重启后还能接着写)
    const keep = convs.filter((c) => c.messages.length > 0 || c.id === activeId);
    localStorage.setItem(CONVS_KEY, JSON.stringify({ convs: keep.slice(-30), activeId }));
  } catch { /* ignore */ }
}

/** AI 对话模块(第一个模块, 无标题): 对话区 + 底部一体输入框(附件/发送) */
export default function ChatModule() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [atts, setAtts] = useState<Att[]>([]);
  const [preview, setPreview] = useState<Att | null>(null); // 图片点击预览(带文件名)
  const [uploading, setUploading] = useState(0);
  const [loading, setLoading] = useState(true); // 历史是否已恢复(避免首屏闪历史)
  const [convs, setConvs] = useState<Conv[]>([]);       // 全部会话
  const [convId, setConvId] = useState<string | null>(null); // 当前会话 id
  const [listOpen, setListOpen] = useState(false);      // 会话列表面板是否展开
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null); // 右键菜单
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 首次加载: 恢复会话(优先有消息的会话, 避免打开空对话)
  useEffect(() => {
    const { convs: cs, activeId } = loadConvs();
    let cur: Conv | null = cs.find((c) => c.id === activeId) || cs[cs.length - 1] || null;
    if (cur && cur.messages.length === 0) {
      // 上次停在空会话(历史遗留): 回退到最近有消息的会话
      const withMsg = [...cs].filter((c) => c.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (withMsg) cur = withMsg;
    }
    if (!cur) {
      cur = { id: `c_${Date.now()}`, title: "新对话", updatedAt: Date.now(), messages: [] };
      cs.push(cur);
    }
    setConvs(cs);
    setConvId(cur.id);
    setMessages(cur.messages);
    setLoading(false);
  }, []);

  // 当前会话消息变化: 自动保存内容(标题/消息), 但**不**更新时间戳
  // (时间只在真正发消息时由 touchConv 更新, 否则切换会话查看会把时间刷成"刚刚")
  useEffect(() => {
    if (loading || !convId) return;
    setConvs((prev) => {
      const next = prev.map((c) =>
        c.id === convId
          ? { ...c, messages, title: c.title !== "新对话" ? c.title : deriveTitle(messages) }
          : c,
      );
      saveConvs(next, convId);
      return next;
    });
  }, [messages, loading, convId]);

  // 更新当前会话的最后对话时间(精确到毫秒存储, 前端自行格式化为 刚刚/N分钟前/年月日时分)
  const touchConv = (): void => {
    if (!convId) return;
    setConvs((prev) => {
      const next = prev.map((c) => (c.id === convId ? { ...c, updatedAt: Date.now() } : c));
      saveConvs(next, convId);
      return next;
    });
  };

  // 切换到某个历史会话
  const openConv = (id: string): void => {
    const c = convs.find((x) => x.id === id);
    if (!c) return;
    // 切换前先把当前会话的最新消息落库(内容不变更时间)
    if (convId && convId !== id) {
      setConvs((prev) => {
        const next = prev.map((x) => (x.id === convId ? { ...x, messages } : x));
        saveConvs(next, id);
        return next;
      });
    }
    setConvId(id);
    setMessages([...c.messages]); // 拷贝, 不共享引用
    setAtts([]);
    setListOpen(false);
  };
  // 新建会话(顺便丢弃其它空会话, 避免列表堆积)
  const newConv = (): void => {
    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const c: Conv = { id, title: "新对话", updatedAt: Date.now(), messages: [] };
    setConvs((prev) => {
      const next = [...prev.filter((x) => x.messages.length > 0), c];
      saveConvs(next, id);
      return next;
    });
    setConvId(id);
    setMessages([]);
    setAtts([]);
    setListOpen(false);
  };
  // 删除会话(右键菜单触发); 删的是当前会话则切到最近一个, 全删光则新建空会话
  const delConv = (id: string): void => {
    setMenu(null);
    const rest = convs.filter((c) => c.id !== id);
    if (rest.length === 0) {
      const c: Conv = { id: `c_${Date.now()}`, title: "新对话", updatedAt: Date.now(), messages: [] };
      setConvs([c]); setConvId(c.id); setMessages([]); setAtts([]); saveConvs([c], c.id);
      return;
    }
    if (id === convId) {
      const fb = rest[rest.length - 1];
      setConvId(fb.id);
      setMessages([...fb.messages]);
      setAtts([]);
    }
    setConvs(rest);
    saveConvs(rest, id === convId ? rest[rest.length - 1].id : convId);
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
        body: JSON.stringify({ message: text, images, messages }),
      });
      const j = (await r.json()) as { detail?: string; reply?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setMessages((m) => [...m, { role: "assistant", content: j.reply || "" }]);
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
    <div style={{ width: 460, display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid #e5e5e5", background: "#fff", overflow: "hidden" }}>
      {/* 对话区(左上角: 圆形会话列表按钮; 点击展开矩形列表) */}
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
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
            background: "#fff",
            border: "1px solid #e5e5e5",
            boxShadow: listOpen ? "0 4px 20px rgba(0,0,0,0.12)" : "0 1px 2px rgba(0,0,0,0.04)",
            overflow: "hidden",
            display: "flex", flexDirection: "column",
            cursor: listOpen ? "default" : "pointer",
            transition: "width .28s cubic-bezier(.4,0,.2,1), height .28s cubic-bezier(.4,0,.2,1), border-radius .28s cubic-bezier(.4,0,.2,1), box-shadow .28s",
          }}
        >
          {/* 收起态: 居中列表图标(展开时淡出; flex 居中避免基线偏移) */}
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: listOpen ? 0 : 1, transition: "opacity .12s", pointerEvents: "none" }}>
            <UnorderedListOutlined style={{ fontSize: 14, color: "#888", display: "block" }} />
          </span>
          {/* 展开态: 标题 + 会话列表(形变后淡入, 高 3~10 行动态) */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", opacity: listOpen ? 1 : 0, transition: "opacity .2s .1s" }}>
            {/* 标题栏(固定在顶部) */}
            <div style={{ flexShrink: 0, height: TITLE, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 12, color: "#999", borderBottom: "1px solid #f5f5f5" }}>
              对话列表
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {shownConvs.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: "#bbb", textAlign: "center" }}>暂无对话</div>
              )}
              {shownConvs.map((c) => (
                <div
                  key={c.id}
                  className="conv-item"
                  onClick={() => openConv(c.id)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: c.id }); }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #f7f7f7", flexShrink: 0, background: c.id === convId ? "#f5f5f5" : undefined }}
                >
                  <span style={{ flex: 1, fontSize: 13, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "新对话"}</span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: "#bbb" }}>{fmtTime(c.updatedAt)}</span>
                </div>
              ))}
            </div>
            <div onClick={newConv} className="conv-new" style={{ flexShrink: 0, height: NEWBTN, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#111", cursor: "pointer", borderTop: "1px solid #f5f5f5", userSelect: "none" }}>
              ＋ 新对话
            </div>
          </div>
        </div>
        {messages.length === 0 && !sending && (
          <div style={{ color: "#aaa", fontSize: 13, textAlign: "center", marginTop: 48 }}>
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
                background: m.role === "user" ? "#111" : "#f2f2f2",
                color: m.role === "user" ? "#fff" : "#111",
                borderTopRightRadius: m.role === "user" ? 4 : 12,
                borderTopLeftRadius: m.role === "user" ? 12 : 4,
              }}
            >
              {m.content}
              {/* 消息携带的图片 */}
              {m.images && m.images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {m.images.map((u) => (
                    <img
                      key={u} src={u}
                      style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)", display: "block" }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <div style={{ color: "#999", fontSize: 12, paddingLeft: 2 }}>正在思考…</div>}
      </div>

      {/* 底部输入区(模块整体的一部分, 不再套独立卡片边框 —— 一体感) */}
      <div className="chat-input-wrap" style={{ borderTop: "1px solid #eee", padding: 10, background: "#fff" }}>
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
                    style={{ position: "relative", width: 56, height: 44, borderRadius: 8, border: "1px solid #eee", flexShrink: 0, cursor: "pointer" }}
                  >
                    {isImg ? (
                      <img src={a.url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 7 }} />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 2, color: "#999", background: "#fafafa" }}>
                        <PaperClipOutlined style={{ fontSize: 15 }} />
                        <span style={{ fontSize: 9, maxWidth: 50, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 4px" }}>{a.name}</span>
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
                <div style={{ width: 44, height: 44, borderRadius: 8, border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 11 }}>
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

          {/* 工具栏: 附件按钮紧挨发送按钮左边 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="*/*"
              style={{ display: "none" }}
              onChange={(e) => void handleFiles(e.target.files)}
            />
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
              loading={sending}
              disabled={!input.trim()}
              onClick={send}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}
            >
              <SendOutlined style={{ display: "block", lineHeight: 0 }} />
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
          <div style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 31, minWidth: 96, background: "#fff", border: "1px solid #eee", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden" }}>
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