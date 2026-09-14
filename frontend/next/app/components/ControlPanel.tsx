"use client";

import { useState } from "react";
import { Button, Card, Divider, InputNumber, Select, Space, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Character, Product, Scene } from "../lib/types";
import LibraryManager, { type LibraryKind } from "./LibraryManager";

interface Props {
  characters: Character[];
  selectedCharacterIds: number[];
  onCharactersChange: (ids: number[]) => void;
  products: Product[];
  selectedProductId?: number;
  onProductChange: (pid: number | undefined) => void;
  scenes: Scene[];
  selectedSceneId?: number;
  onSceneChange: (id: number | undefined) => void;
  duration: number;
  resolution: string;
  ratio: string;
  onParamsChange: (p: { duration?: number; resolution?: string; ratio?: string }) => void;
  onDataChanged: () => void; // 库数据变更后刷新
}

const thumb = (photos?: string[]) =>
  photos && photos.length ? (
    <img
      src={photos[0]}
      style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 4, border: "1px solid #eee", display: "block" }}
    />
  ) : null;

const ellipsis = (t?: string, maxWidth = 220) => (
  <span
    title={t || ""}
    style={{
      display: "block", maxWidth, color: t ? "#666" : "#ccc", fontSize: 12,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}
  >
    {t || "—"}
  </span>
);

const managerBtn = (label: string, kind: LibraryKind, onClick: (k: LibraryKind) => void) => (
  <Divider plain orientation="left" orientationMargin={0} style={{ margin: "12px 0 6px" }}>
    <Space size={6}>
      <span>{label}</span>
      <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => onClick(kind)}>管理</Button>
    </Space>
  </Divider>
);

export default function ControlPanel(p: Props) {
  const [managerKind, setManagerKind] = useState<LibraryKind | null>(null);
  const tipFor = (c: Character) =>
    (c.prompt || "").trim() ? c.prompt!.trim().slice(0, 100) : `${c.profession} · ${c.traits} · ${c.look}`;

  const characterCols: ColumnsType<Character> = [
    {
      title: "名称",
      render: (_, c) => (
        <Tooltip title={tipFor(c)}>
          <span style={{ cursor: "help" }}>{c.name}</span>
        </Tooltip>
      ),
    },
    { title: "照片", width: 74, render: (_, c) => thumb(c.photos) },
  ];

  const sceneCols: ColumnsType<Scene> = [
    { title: "场景名称", width: 110, render: (_, s) => s.name },
    { title: "场景提示词", render: (_, s) => ellipsis(s.prompt) },
  ];

  const productCols: ColumnsType<Product> = [
    { title: "产品名称", width: 110, render: (_, x) => x.name },
    { title: "产品提示词", render: (_, x) => ellipsis(x.prompt) },
  ];

  return (
    <Card size="small" title="剧本配置" style={{ height: "100%" }}>
      <Space orientation="vertical" size={6} style={{ width: "100%" }}>
        {managerBtn("人物库", "character", setManagerKind)}
        <Table<Character>
          size="small" rowKey="id" pagination={false}
          dataSource={p.characters}
          rowSelection={{
            selectedRowKeys: p.selectedCharacterIds,
            onChange: (keys) => p.onCharactersChange(keys as number[]),
          }}
          scroll={{ y: 140 }}
          columns={characterCols}
        />

        {managerBtn("场景库", "scene", setManagerKind)}
        <Table<Scene>
          size="small" rowKey="id" pagination={false}
          dataSource={p.scenes}
          rowSelection={{
            type: "radio",
            selectedRowKeys: p.selectedSceneId ? [p.selectedSceneId] : [],
            onChange: (keys) => p.onSceneChange(keys[0] as number),
          }}
          scroll={{ y: 108 }}
          columns={sceneCols}
        />

        {managerBtn("产品库", "product", setManagerKind)}
        <Table<Product>
          size="small" rowKey="id" pagination={false}
          dataSource={p.products}
          rowSelection={{
            type: "radio",
            selectedRowKeys: p.selectedProductId ? [p.selectedProductId] : [],
            onChange: (keys) => p.onProductChange(keys[0] as number),
          }}
          scroll={{ y: 108 }}
          columns={productCols}
        />

        <Divider plain orientation="left" orientationMargin={0} style={{ margin: "12px 0 6px" }}>生成参数</Divider>
        <Space wrap size={12} style={{ paddingLeft: 4, paddingBottom: 6 }}>
          <Space size={4}>
            <span style={{ fontSize: 12 }}>时长</span>
            <Space.Compact size="small">
              <InputNumber
                min={1} max={30}
                value={p.duration}
                onChange={(v) => p.onParamsChange({ duration: v ?? undefined })}
                style={{ width: 72 }}
              />
              <span style={{
                display: "inline-flex", alignItems: "center", padding: "0 8px", fontSize: 12,
                background: "#f5f5f5", border: "1px solid #d9d9d9", borderInlineStart: "none",
                borderStartEndRadius: 6, borderEndEndRadius: 6,
              }}>秒</span>
            </Space.Compact>
          </Space>
          <Space size={4}>
            <span style={{ fontSize: 12 }}>分辨率</span>
            <Select
              size="small" style={{ width: 90 }}
              value={p.resolution}
              onChange={(v) => p.onParamsChange({ resolution: v })}
              options={["720p", "1080p"].map((r) => ({ label: r, value: r }))}
            />
          </Space>
          <Space size={4}>
            <span style={{ fontSize: 12 }}>比例</span>
            <Select
              size="small" style={{ width: 100 }}
              value={p.ratio}
              onChange={(v) => p.onParamsChange({ ratio: v })}
              options={[
                { label: "竖屏 9:16", value: "9:16" },
                { label: "横屏 16:9", value: "16:9" },
              ]}
            />
          </Space>
        </Space>
      </Space>

      {managerKind && (
        <LibraryManager
          kind={managerKind} open onClose={() => setManagerKind(null)} onChanged={p.onDataChanged}
        />
      )}
    </Card>
  );
}