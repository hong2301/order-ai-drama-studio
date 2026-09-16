"use client";

// 顶部 API Key 设置: 弹窗查看/修改 DOUBAO_API_KEY(即时生效 + 写入 .env)
import { useEffect, useState } from "react";
import { App as AntApp, Button, Input, Modal } from "antd";
import { KeyOutlined } from "@ant-design/icons";

export default function KeySettings(): React.JSX.Element {
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/settings/key")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setKey(j.key || ""); })
      .catch(() => message.warning("读取 API Key 失败"));
  }, [open, message]);

  const save = async (): Promise<void> => {
    const k = key.trim();
    if (!k) { message.warning("API Key 不能为空"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/settings/key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const j = (await r.json()) as { ok?: boolean; detail?: string };
      if (!r.ok || !j.ok) throw new Error(j.detail || "保存失败");
      message.success("API Key 已更新（已保存到数据库，即时生效）");
      setOpen(false);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="default"
        icon={<KeyOutlined />}
        onClick={() => setOpen(true)}
        title="修改 API Key"
        style={{ display: "inline-flex", alignItems: "center" }}
      />
      <Modal open={open} title="API Key 设置" onCancel={() => setOpen(false)} footer={null} width={460} destroyOnHidden>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>
          DOUBAO_API_KEY（豆包/火山方舟）。保存后存入数据库并即时生效，对话 / 解析 / 生成 / 探测均使用。
        </p>
        <Input.Password
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="粘贴新的 API Key"
          autoComplete="off"
          style={{ fontSize: 13 }}
        />
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
        </div>
      </Modal>
    </>
  );
}