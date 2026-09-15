"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, message } from "antd";
import { PaperClipOutlined, SendOutlined } from "@ant-design/icons";

interface Msg { role: "user" | "assistant"; content: string; images?: string[] }
interface Att { name: string; url: string }

const MAX_ATTACH = 9; // 最多 9 个附件

/** AI 对话模块(第一个模块, 无标题): 对话区 + 底部一体输入框(附件/发送) */
export default function ChatModule() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [atts, setAtts] = useState<Att[]>([]);
  const [preview, setPreview] = useState<string | null>(null); // 图片点击预览
  const [uploading, setUploading] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
        body: JSON.stringify({ message: text, images }),
      });
      const j = (await r.json()) as { detail?: string; reply?: string };
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setMessages((m) => [...m, { role: "assistant", content: j.reply || "" }]);
    } catch (e) {
      message.error((e as Error).message);
      setMessages((m) => [...m, { role: "assistant", content: `(调用失败) ${(e as Error).message}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ width: 460, display: "flex", flexDirection: "column", borderRadius: 12, border: "1px solid #e5e5e5", background: "#fff", overflow: "hidden" }}>
      {/* 对话区 */}
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
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
                      if (isImg) setPreview(a.url);
                      else window.open(a.url, "_blank");
                    }}
                    style={{ position: "relative", width: 56, height: 44, borderRadius: 8, overflow: "hidden", border: "1px solid #eee", flexShrink: 0, cursor: "pointer" }}
                  >
                    {isImg ? (
                      <img src={a.url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)", zIndex: 2,
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
              icon={<PaperClipOutlined />}
              onClick={() => fileRef.current?.click()}
              title="上传附件（最多 9 个）"
            />
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<SendOutlined />}
              loading={sending}
              disabled={!input.trim()}
              onClick={send}
            />
          </div>
      </div>

      {/* 图片点击预览 */}
      <Modal open={!!preview} footer={null} closable onCancel={() => setPreview(null)} width={800} style={{ top: 30 }}>
        {preview && <img src={preview} alt="预览" style={{ width: "100%", display: "block", borderRadius: 4 }} />}
      </Modal>
    </div>
  );
}