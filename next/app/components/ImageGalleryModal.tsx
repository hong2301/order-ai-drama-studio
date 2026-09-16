"use client";

// 资料库记录的图片管理弹窗: 展示/添加/移除图片 + 名称编辑(默认取文件名)
// 交互: 拖拽 或 文件选择器 加入待添加区 → 点「确认」统一提交(上传新图 + 改名 + 写回记录 image_ids)
// 取消 = 放弃本次改动; 移除的图片只解除与该记录的关联(不删图库文件, 避免误删他处引用)
import { useEffect, useState } from "react";
import { App as AntApp, Button, Input, Modal, Upload } from "antd";
import { CloseOutlined, InboxOutlined, UndoOutlined } from "@ant-design/icons";

export interface GalleryImage { id: number; path: string; name: string; description: string }

/** 待添加上传项(本地文件, 未入库) */
interface PendingItem { key: string; file: File; name: string; url: string }

const IMG_RE = /\.(jpe?g|png|gif|webp)$/i;

export default function ImageGalleryModal(props: {
  open: boolean;
  /** 记录名称(标题展示) */
  recordName: string;
  /** 记录所属接口, 如 /api/characters */
  api: string;
  recordId: number;
  images: GalleryImage[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { open, recordName, api, recordId, images, onCancel, onSaved } = props;
  const { message } = AntApp.useApp();

  const [existing, setExisting] = useState<GalleryImage[]>([]); // 保留的已有图片(名称可编辑)
  const [removed, setRemoved] = useState<GalleryImage[]>([]);   // 本次移除(可撤销, 确认后生效)
  const [pending, setPending] = useState<PendingItem[]>([]);    // 待上传
  const [saving, setSaving] = useState(false);

  // 打开时重置: 以传入记录为准(关闭时一并释放预览 URL)
  useEffect(() => {
    setPending((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    if (!open) return;
    setExisting(images || []);
    setRemoved([]);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordId]);

  /** 加入待上传: 默认名称取文件名(去扩展名) */
  const addFiles = (files: File[]): void => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || IMG_RE.test(f.name));
    if (!imgs.length) { message.warning("仅支持图片文件(jpg/png/gif/webp)"); return; }
    if (imgs.length < files.length) message.warning(`已忽略 ${files.length - imgs.length} 个非图片文件`);
    setPending((prev) => [
      ...prev,
      ...imgs.map((f) => ({
        key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        name: f.name.replace(/\.[^.]+$/, ""),
        url: URL.createObjectURL(f),
      })),
    ]);
  };

  const removeExisting = (id: number): void => {
    const hit = existing.find((x) => x.id === id);
    if (!hit) return;
    setExisting((prev) => prev.filter((x) => x.id !== id));
    setRemoved((prev) => [...prev, hit]);
  };

  const undoRemove = (id: number): void => {
    const hit = removed.find((x) => x.id === id);
    if (!hit) return;
    setRemoved((prev) => prev.filter((x) => x.id !== id));
    setExisting((prev) => [...prev, hit]);
  };

  const dropPending = (key: string): void => {
    setPending((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.key !== key);
    });
  };

  /** 确认: 已有改名 → 上传新增 → 写回记录 image_ids */
  const confirm = async (): Promise<void> => {
    setSaving(true);
    try {
      // 1) 已有图片改名(仅名称变化的)
      for (const img of existing) {
        const orig = (images || []).find((x) => x.id === img.id);
        if (orig && (orig.name || "") !== (img.name || "")) {
          const r = await fetch(`/api/images/${img.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: img.name }),
          });
          const j = (await r.json()) as { detail?: string };
          if (!r.ok) throw new Error(j.detail || "图片改名失败");
        }
      }
      // 2) 上传待添加(名称用表单里的值)
      const newIds: number[] = [];
      for (const p of pending) {
        const fd = new FormData();
        fd.append("file", p.file);
        fd.append("name", p.name.trim() || p.file.name.replace(/\.[^.]+$/, ""));
        const r = await fetch("/api/images/upload", { method: "POST", body: fd });
        const j = (await r.json()) as { detail?: string; id?: number };
        if (!r.ok || !j.id) throw new Error(j.detail || `上传失败: ${p.file.name}`);
        newIds.push(j.id);
      }
      // 3) 关联写回记录
      const finalIds = [...existing.map((x) => x.id), ...newIds];
      const r = await fetch(`${api}/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_ids: finalIds }),
      });
      const j = (await r.json()) as { detail?: string; ok?: boolean };
      if (!r.ok) throw new Error(j.detail || "保存失败");
      message.success(`图片已更新(共 ${finalIds.length} 张)`);
      onSaved();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cellStyle: React.CSSProperties = { width: 88, display: "flex", flexDirection: "column", gap: 4 };
  const thumbStyle: React.CSSProperties = { width: 88, height: 88, borderRadius: 8, objectFit: "cover", display: "block", border: "1px solid #eee", background: "#fafafa" };

  return (
    <Modal
      open={open}
      title={`${recordName || "记录"} · 图片`}
      onCancel={onCancel}
      width={620}
      destroyOnHidden
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#999" }}>
            已有 {existing.length} 张{removed.length ? ` · 将移除 ${removed.length} 张` : ""}{pending.length ? ` · 待添加 ${pending.length} 张` : ""}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button onClick={onCancel} disabled={saving}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void confirm()}>确认</Button>
          </span>
        </div>
      }
    >
      {/* 拖拽 / 点击选择 */}
      <Upload.Dragger
        multiple
        accept="image/*"
        showUploadList={false}
        beforeUpload={(file) => { addFiles([file as unknown as File]); return false; }}
        style={{ padding: "6px 0", marginBottom: 12 }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
          <InboxOutlined style={{ fontSize: 20, color: "#999", display: "block", marginBottom: 4 }} />
          点击选择图片，或把图片拖到这里（支持多选）
        </p>
      </Upload.Dragger>

      {/* 待添加(确认后上传入库) */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>待添加（默认名称取文件名，可修改）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {pending.map((p) => (
              <div key={p.key} style={cellStyle}>
                <div style={{ position: "relative" }}>
                  <img src={p.url} style={thumbStyle} alt={p.name} />
                  <CloseOutlined
                    onClick={() => dropPending(p.key)}
                    title="移除"
                    style={{ position: "absolute", top: 4, right: 4, fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: "50%", padding: 3, cursor: "pointer" }}
                  />
                </div>
                <Input
                  size="small"
                  value={p.name}
                  placeholder="图片名称"
                  onChange={(e) => setPending((prev) => prev.map((x) => (x.key === p.key ? { ...x, name: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 已有图片 */}
      <div style={{ fontSize: 12, color: "#999", marginBottom: 6 }}>已有图片（点名称可改）</div>
      {existing.length === 0 && removed.length === 0 ? (
        <div style={{ fontSize: 12, color: "#ccc", padding: "8px 0" }}>暂无图片</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {existing.map((img) => (
            <div key={img.id} style={cellStyle}>
              <div style={{ position: "relative" }}>
                <img src={img.path} style={thumbStyle} alt={img.name} />
                <CloseOutlined
                  onClick={() => removeExisting(img.id)}
                  title="移除(确认后生效)"
                  style={{ position: "absolute", top: 4, right: 4, fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: "50%", padding: 3, cursor: "pointer" }}
                />
              </div>
              <Input
                size="small"
                value={img.name}
                placeholder="图片名称"
                onChange={(e) => setExisting((prev) => prev.map((x) => (x.id === img.id ? { ...x, name: e.target.value } : x)))}
              />
            </div>
          ))}
          {/* 已移除(可撤销) */}
          {removed.map((img) => (
            <div key={`rm_${img.id}`} style={{ ...cellStyle, opacity: 0.45 }}>
              <div style={{ position: "relative" }}>
                <img src={img.path} style={{ ...thumbStyle, filter: "grayscale(1)" }} alt={img.name} />
                <UndoOutlined
                  onClick={() => undoRemove(img.id)}
                  title="撤销移除"
                  style={{ position: "absolute", top: 4, right: 4, fontSize: 11, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: "50%", padding: 3, cursor: "pointer" }}
                />
              </div>
              <div style={{ fontSize: 11, color: "#999", textAlign: "center" }}>将移除</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}