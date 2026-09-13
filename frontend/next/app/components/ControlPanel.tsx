"use client";

import { Card, Checkbox, Divider, Empty, Radio, Select, Space, Tag, Tooltip } from "antd";
import type { Character, Product, Scene, StoryTemplate, VideoRhythm } from "../lib/types";

export type Mode = "structured" | "free";

interface Props {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  characters: Character[];
  selectedCharacterIds: number[];
  onCharactersChange: (ids: number[]) => void;
  products: Product[];
  selectedProductId?: number;
  appearWay: string;
  onProductChange: (pid: number | undefined, way: string) => void;
  scenes: Scene[];
  selectedSceneId?: number;
  onSceneChange: (id: number | undefined) => void;
  templates: StoryTemplate[];
  selectedTemplateId?: number;
  onTemplateChange: (id: number | undefined) => void;
  rhythms: VideoRhythm[];
  selectedRhythmId?: number;
  onRhythmChange: (id: number | undefined) => void;
  duration: number;
  resolution: string;
  ratio: string;
  onParamsChange: (p: { duration?: number; resolution?: string; ratio?: string }) => void;
}

export default function ControlPanel(p: Props) {
  const prod = p.products.find((x) => x.id === p.selectedProductId);
  return (
    <Card size="small" title="剧本配置" style={{ height: "100%" }}>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Radio.Group
          value={p.mode} onChange={(e) => p.onModeChange(e.target.value)}
          options={[
            { label: "格式化配置（选人物/场景/产品）", value: "structured" },
            { label: "自由提示词（直接粘贴完整提示词）", value: "free" },
          ]}
          optionType="button" buttonStyle="solid" style={{ width: "100%" }}
        />

        {p.mode === "free" ? (
          <div style={{ fontSize: 12, color: "#888" }}>
            已切换到自由模式：在下方提示词框直接粘贴/编写一段完整 Seedance 视频提示词即可生成，
            此面板的结构化配置不会被使用。
          </div>
        ) : (
          <>
            <Divider plain style={{ margin: "4px 0" }}>人物（参与本集）</Divider>
            {p.characters.length === 0 ? (
              <Empty description="暂无人物" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Checkbox.Group
                value={p.selectedCharacterIds}
                onChange={(vals) => p.onCharactersChange(vals as number[])}
                style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
              >
                {p.characters.map((c) => (
                  <Checkbox key={c.id} value={c.id} style={{ lineHeight: "22px" }}>
                    <Tooltip title={`${c.profession} · ${c.traits} · ${c.look}`}>
                      {c.name}
                      <span style={{ color: "#999", marginLeft: 3, fontSize: 11 }}>{c.family_role}</span>
                    </Tooltip>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            )}

            <Divider plain style={{ margin: "4px 0" }}>场景</Divider>
            <Select
              style={{ width: "100%" }} allowClear placeholder="选择生活场景"
              value={p.selectedSceneId}
              onChange={p.onSceneChange}
              options={p.scenes.map((s) => ({
                value: s.id,
                label: (
                  <Space size={4}>
                    <span>{s.name}</span>
                    <span style={{ color: "#aaa", fontSize: 12 }}>{s.location} · {s.timing}</span>
                  </Space>
                ),
              }))}
            />

            <Divider plain style={{ margin: "4px 0" }}>产品</Divider>
            <Select
              style={{ width: "100%" }} placeholder="选择产品"
              value={p.selectedProductId}
              onChange={(v) => p.onProductChange(v, "")}
              options={p.products.map((x) => ({
                value: x.id,
                label: <Space size={4}><span>{x.name}</span><Tag style={{ marginInlineEnd: 0 }}>{x.category}</Tag></Space>,
              }))}
            />
            {prod && (
              <>
                <div style={{ fontSize: 12, color: "#888" }}>适合：{prod.fit_persons.join("、") || "—"}</div>
                <div style={{ fontSize: 12, color: "#888" }}>说明：{prod.desc || "—"}</div>
                <Select
                  style={{ width: "100%" }} placeholder="产品出现方式"
                  value={p.appearWay || undefined}
                  onChange={(v) => p.onProductChange(prod.id, v)}
                  options={prod.appear_ways.map((w) => ({ value: w, label: w }))}
                />
              </>
            )}

            <Divider plain style={{ margin: "4px 0" }}>故事模板（冲突与节拍）</Divider>
            <Select
              style={{ width: "100%" }} allowClear placeholder="选一个故事模板"
              value={p.selectedTemplateId}
              onChange={p.onTemplateChange}
              options={p.templates.map((t) => ({
                value: t.id,
                label: `${t.name}（${t.story_line} · ${t.conflict}）`,
              }))}
            />

            <Divider plain style={{ margin: "4px 0" }}>视频节奏</Divider>
            <Select
              style={{ width: "100%" }} allowClear placeholder="选择节奏结构"
              value={p.selectedRhythmId}
              onChange={p.onRhythmChange}
              options={p.rhythms.map((r) => ({ value: r.id, label: `${r.name}（${r.duration}s）` }))}
            />

            <Divider plain style={{ margin: "4px 0" }}>生成参数</Divider>
            <Space wrap>
              <span style={{ fontSize: 12 }}>时长</span>
              <Radio.Group
                size="small" value={p.duration}
                onChange={(e) => p.onParamsChange({ duration: e.target.value })}
                options={[5, 10].map((d) => ({ label: `${d}秒`, value: d }))}
                optionType="button"
              />
              <span style={{ fontSize: 12 }}>分辨率</span>
              <Radio.Group
                size="small" value={p.resolution}
                onChange={(e) => p.onParamsChange({ resolution: e.target.value })}
                options={["720p", "1080p"].map((r) => ({ label: r, value: r }))}
                optionType="button"
              />
              <span style={{ fontSize: 12 }}>比例</span>
              <Radio.Group
                size="small" value={p.ratio}
                onChange={(e) => p.onParamsChange({ ratio: e.target.value })}
                options={[{ label: "竖屏9:16", value: "9:16" }, { label: "横屏16:9", value: "16:9" }]}
                optionType="button"
              />
            </Space>
            <div style={{ fontSize: 11, color: "#aaa" }}>
              提示：Seedance 单次生成 5 或 10 秒；完整 15 秒将在后续版本支持自动分段拼接。
            </div>
          </>
        )}
      </Space>
    </Card>
  );
}