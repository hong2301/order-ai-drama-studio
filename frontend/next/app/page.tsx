"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Col, Row, message } from "antd";
import Header from "./Header";
import ModelPanel from "./components/ModelPanel";
import ControlPanel, { type Mode } from "./components/ControlPanel";
import PromptBox from "./components/PromptBox";
import ResultArea from "./components/ResultArea";
import { api } from "./lib/api";
import type {
  AiConfig, Character, Generation, GenerationCreate, Product, Scene, StoryTemplate, VideoRhythm,
} from "./lib/types";

export default function Home() {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [configs, setConfigs] = useState<AiConfig[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [templates, setTemplates] = useState<StoryTemplate[]>([]);
  const [rhythms, setRhythms] = useState<VideoRhythm[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);

  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("structured");
  const [characterIds, setCharacterIds] = useState<number[]>([]);
  const [productId, setProductId] = useState<number | undefined>();
  const [appearWay, setAppearWay] = useState("");
  const [sceneId, setSceneId] = useState<number | undefined>();
  const [templateId, setTemplateId] = useState<number | undefined>();
  const [rhythmId, setRhythmId] = useState<number | undefined>();
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [ratio, setRatio] = useState("9:16");

  const [prompt, setPrompt] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedGen, setSelectedGen] = useState<number | null>(null);

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const h = await api.get<{ status: string }>("/api/health");
      setHealthy(h.status === "ok");
      const [cfg, ch, pr, sc, tp, rh, gn] = await Promise.all([
        api.get<AiConfig[]>("/api/ai/configs"),
        api.get<Character[]>("/api/characters"),
        api.get<Product[]>("/api/products"),
        api.get<Scene[]>("/api/scenes"),
        api.get<StoryTemplate[]>("/api/story-templates"),
        api.get<VideoRhythm[]>("/api/video-rhythms"),
        api.get<Generation[]>("/api/generations"),
      ]);
      setConfigs(cfg); setCharacters(ch); setProducts(pr); setScenes(sc);
      setTemplates(tp); setRhythms(rh); setGenerations(gn);
      // 首次默认
      setSelectedModelId((prev) => prev ?? cfg.find((x) => x.kind === "video")?.id ?? null);
      setRhythmId((prev) => prev ?? rh[0]?.id);
      setTemplateId((prev) => prev ?? tp[1]?.id ?? tp[0]?.id);
      setSceneId((prev) => prev ?? sc[2]?.id);
      setProductId((prev) => prev ?? pr[0]?.id);
      setCharacterIds((prev) => (prev.length ? prev : ch.slice(0, 2).map((c) => c.id)));
      setSelectedGen((prev) => prev ?? gn[0]?.id ?? null);
    } catch (e) {
      setHealthy(false);
      console.error("loadAll:", e);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // 生成中轮询
  useEffect(() => {
    const hasPending = generations.some((g) => g.status === "queued" || g.status === "running");
    if (!hasPending) return;
    const t = setInterval(async () => {
      try { setGenerations(await api.get<Generation[]>("/api/generations")); } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, [generations]);

  // 结构化配置变化 -> 防抖刷新提示词预览
  useEffect(() => {
    if (mode !== "structured") return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const r = await api.post<{ prompt: string }>("/api/generations/preview", structuredPayload());
        setPrompt(r.prompt);
        setPromptDirty(false);
      } catch (e) {
        // 未选够仍可预览的部分场景导致的错误忽略, 保留旧文本
        console.error("preview:", e);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, characterIds, productId, appearWay, sceneId, templateId, rhythmId, duration, resolution, ratio]);

  const structuredPayload = (): GenerationCreate => ({
    mode: "structured",
    title: "",
    character_ids: characterIds,
    product_id: productId,
    appear_way: appearWay,
    scene_id: sceneId,
    template_id: templateId,
    rhythm_id: rhythmId,
    duration,
    resolution,
    ratio,
    seed: -1,
  });

  const handleGenerate = async () => {
    if (!prompt.trim()) { message.warning("提示词为空"); return; }
    setGenerating(true);
    try {
      const body: GenerationCreate =
        mode === "free"
          ? { mode: "free", title: "自由模式", prompt, character_ids: [], appear_way: "", duration, resolution, ratio, seed: -1 }
          : { ...structuredPayload(), title: "", prompt_override: promptDirty ? prompt : undefined };
      const g = await api.post<Generation>("/api/generations", body);
      message.success(`已提交生成任务 #${g.id}`);
      setPromptDirty(false);
      setGenerations(await api.get<Generation[]>("/api/generations"));
      setSelectedGen(g.id);
    } catch (e) {
      message.error(String((e as Error).message));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column", background: "#f5f6f8", padding: "0 20px 14px" }}>
      <Header healthy={healthy} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <Row gutter={12} style={{ height: "100%" }}>
          <Col span={6} style={{ height: "100%" }}>
            <ModelPanel
              configs={configs}
              selectedId={selectedModelId}
              onSelect={setSelectedModelId}
              onChanged={loadAll}
            />
          </Col>
          <Col span={11} style={{ height: "100%" }}>
            <Row gutter={12} style={{ height: "100%" }}>
              <Col span={13} style={{ height: "100%", overflow: "auto" }}>
                <ControlPanel
                  mode={mode} onModeChange={setMode}
                  characters={characters} selectedCharacterIds={characterIds} onCharactersChange={setCharacterIds}
                  products={products} selectedProductId={productId} appearWay={appearWay}
                  onProductChange={(pid, way) => { setProductId(pid); setAppearWay(way || ""); }}
                  scenes={scenes} selectedSceneId={sceneId} onSceneChange={setSceneId}
                  templates={templates} selectedTemplateId={templateId} onTemplateChange={setTemplateId}
                  rhythms={rhythms} selectedRhythmId={rhythmId} onRhythmChange={setRhythmId}
                  duration={duration} resolution={resolution} ratio={ratio}
                  onParamsChange={(p) => { if (p.duration !== undefined) setDuration(p.duration); if (p.resolution) setResolution(p.resolution); if (p.ratio) setRatio(p.ratio); }}
                />
              </Col>
              <Col span={11} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <PromptBox
                  mode={mode}
                  prompt={prompt} dirty={promptDirty} loading={previewLoading} generating={generating}
                  onPromptEdit={(t) => { setPrompt(t); if (mode === "structured") setPromptDirty(true); }}
                  onGenerate={handleGenerate}
                />
              </Col>
            </Row>
          </Col>
          <Col span={7} style={{ height: "100%" }}>
            <ResultArea
              generations={generations}
              selectedId={selectedGen}
              onSelect={setSelectedGen}
              onChanged={loadAll}
            />
          </Col>
        </Row>
      </div>
    </div>
  );
}