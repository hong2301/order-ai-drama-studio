"use client";

// 人物库「音色」管理弹窗: 上传多段参考音频(如「正常说话」「生气」「撒娇」),
// 每段可改名、试听、删除。生成视频时作为 reference_audio 注入(音色参考)。
// 设计取向: 一段通常就够, 但支持多段(按情绪/场景区分)。
import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp, Button, Input, Modal, Popconfirm, Upload } from "antd";
import { DeleteOutlined, PlusOutlined, SoundOutlined } from "@ant-design/icons";
import type { UploadFile } from "antd/es/upload/interface";

export interface AudioItem {
  id: number;
  path: string;
  name: string;
  description?: string;
}

export default function AudioManagerModal(props: {
  open: boolean;
  /** 归属记录(人物)的 id 与已有音频 id 列表 */
  recordId: number;
  audioIds: number[];
  onClose: () => void;
  onChanged: (ids: number[]) => void;
}): React.JSX.Element {
  const { open, recordId, audioIds, onClose, onChanged } = props;
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<AudioItem[]>([]);        // 已关联的音频
  const [newIds, setNewIds] = useState<number[]>([]);         // 本次新上传/新关联的
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 打开时拉取已关联音频的明细
  useEffect(() => {
    if (!open) return;
    setNewIds([]);
    if (!audioIds.length) { setItems([]); return; }
    fetch("/api/audios")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("音频加载失败"))))
      .then((j: { items?: AudioItem[] }) => {
        const map = new Map((j.items || []).map((a) => [a.id, a]));
        setItems(audioIds.map((i) => map.get(i)).filter((x): x is AudioItem => !!x));
      })
      .catch((e: Error) => message.error(e.message));
  }, [open, audioIds, message]);

  /** 上传一段音频(未落库前先不入人物记录, 保存时统一关联) */
  const uploadOne = useCallback(async (f: File): Promise<void> => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("name", f.name.replace(/\.\w+$/, "").slice(0, 20) || "音色");
      const r = await fetch("/api/audios/upload", { method: "POST", body: fd });
      const j = (await r.json()) as { ok?: boolean; detail?: string; id?: number; name?: string; path?: string };
      if (!r.ok || !j.ok) throw new Error(j.detail || "上传失败");
      const it: AudioItem = { id: Number(j.id), path: String(j.path || ""), name: String(j.name || "") };
      setItems((prev) => [...prev, it]);
      setNewIds((prev) => [...prev, it.id]);
      message.success("已上传");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }, [message]);

  /** 改名(立即落库) */
  const rename = useCallback(async (id: number, name: string): Promise<void> => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, name } : x)));
    try {
      const r = await fetch(`/api/audios/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error("改名失败");
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [message]);

  /** 从该人物移除一段音频(只是解除关联, 音频记录保留) */
  const remove = useCallback((id: number): void => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    setNewIds((prev) => prev.filter((x) => x !== id));
  }, []);

  /** 保存: 把当前列表的 id 集合写回人物的 audio_ids */
  const save = useCallback((): void => {
    onChanged(items.map((x) => x.id));
    onClose();
  }, [items, onChanged, onClose]);

  const fileList: UploadFile[] = [];

  return (
    <Modal
      open={open}
      title="音色参考音频"
      width={520}
      destroyOnHidden
      onCancel={onClose}
      onOk={save}
      okText="保存"
      cancelText="取消"
    >
      <div style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 10, lineHeight: 1.7 }}>
        上传该人物说话的音频，生成视频时会作为<b>音色参考</b>注入（建议 5~15 秒的清晰人声）。
        可传多段并按情绪命名（如「正常说话」「生气」），生成时默认取第一段。
      </div>

      {/* 音频列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
        {items.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, border: "1px solid var(--border-2)", borderRadius: 8, background: "var(--bg-subtle)" }}>
            <SoundOutlined style={{ color: "var(--text-3)" }} />
            <Input
              size="small"
              value={a.name}
              onChange={(e) => setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
              onBlur={(e) => { const nv = e.target.value.trim() || "音色"; if (nv !== a.name) void rename(a.id, nv); }}
              placeholder="如：正常说话"
              style={{ width: 130 }}
            />
            <audio src={a.path} controls preload="none" style={{ height: 30, flex: 1, minWidth: 0 }} />
            <Popconfirm title="移除这段音频？" onConfirm={() => remove(a.id)} okText="移除" cancelText="取消">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} title="从该人物移除" />
            </Popconfirm>
          </div>
        ))}
        {!items.length && (
          <div style={{ padding: "14px 0", textAlign: "center", color: "var(--text-5)", fontSize: 12 }}>
            还没有音频，点下面上传
          </div>
        )}
      </div>

      {/* 上传 */}
      <div style={{ marginTop: 12 }}>
        <Upload
          accept=".mp3,.wav,.m4a,.aac,.ogg,.flac"
          fileList={fileList}
          showUploadList={false}
          beforeUpload={(_f, files) => { void uploadOne(files[0] as unknown as File); return false; }}
        >
          <Button icon={<PlusOutlined />} loading={uploading} size="small">上传音频（mp3 / wav / m4a…）</Button>
        </Upload>
        <input ref={fileRef} type="file" hidden />
      </div>
      {newIds.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-5)" }}>
          本次新增 {newIds.length} 段，点「保存」后与该人物关联
        </div>
      )}
    </Modal>
  );
}
