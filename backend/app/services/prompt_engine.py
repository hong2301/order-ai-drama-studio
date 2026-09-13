# -*- coding: utf-8 -*-
"""提示词引擎 ★核心抽象

两种模式:
  structured -- 把 人物/场景/产品/模板(故事线)/节奏 等格式化配置 组装成一份完整 Seedance 提示词
  free       -- 用户直接粘贴/编辑整段提示词, 原样透传

结构化组装固定包含:
  1. 系列设定(品牌/叙事原则/结尾约束)   -> 保证风格连续
  2. 人物外形(角色一致性)               -> 每集可识别
  3. 场景与环境
  4. 产品出现动作(自然、不喊购买)
  5. 模板故事线/冲突 + 节奏分段提示
  6. 输出规范(竖屏/时长/镜头/风格)
"""

SERIES_SETTING = """《嘴硬家属》15秒家庭情感短剧。固定人物、固定关系、持续连载的一家人日常。
叙事原则：
- 每集只讲一件小事，前半段有轻微冲突，后半段完成关心反转；
- 产品通过放进背包、放进冰箱、放进行李箱等动作自然出现，不承担说教任务；
- 结尾强调家人关系，不直接喊购买，不宣传治疗作用，不出现吃完立即见效画面。"""


def _persons_block(characters: list) -> str:
    """人物块: 每人一行, 名字+家庭角色+年龄职业+性格+外形(保证生成一致性)"""
    lines = []
    for c in characters:
        parts = []
        name = (c.get("name") or "").strip()
        role = (c.get("family_role") or "").strip()
        parts.append(f"{name}({role})" if role else name)
        age = c.get("age")
        if age:
            parts.append(f"{age}岁")
        prof = (c.get("profession") or "").strip()
        if prof:
            parts.append(prof)
        traits = (c.get("traits") or "").strip()
        if traits:
            parts.append(traits)
        look = (c.get("look") or "").strip()
        if look:
            parts.append(f"外形：{look}")
        lines.append("、".join(parts))
    return "\n".join(lines)


def _product_block(product: dict, appear_way: str) -> str:
    name = (product.get("name") or "").strip()
    way = (appear_way or "").strip()
    if way:
        return f"产品：{name}。出现方式：{way}。画面中保留2至3秒清晰露出产品。"
    return f"产品：{name}。通过放进背包/冰箱/行李箱等自然动作出现，画面中保留2至3秒清晰露出。"


def _scene_block(scene: dict) -> str:
    name = (scene.get("name") or "").strip()
    loc = (scene.get("location") or "").strip()
    d = (scene.get("desc") or "").strip()
    at = (scene.get("atmosphere") or "").strip()
    parts = [name, f"({loc})" if loc else "", d or ""]
    line = " ".join(p for p in parts if p)
    if at:
        line += f"，氛围：{at}"
    return line


def _template_block(template: dict) -> str:
    """模板块: 故事线 + 冲突 + 分秒节拍"""
    lines = []
    sl = (template.get("story_line") or "").strip()
    if sl:
        lines.append(f"故事线：{sl}")
    rh = (template.get("relation_hint") or "").strip()
    if rh:
        lines.append(f"主要人物关系：{rh}")
    cf = (template.get("conflict") or "").strip()
    if cf:
        lines.append(f"核心冲突：{cf}")
    beats = template.get("beats") or []
    if beats:
        lines.append("叙事节拍：")
        for b in beats:
            seg = f"第{b.get('start', 0)}至{b.get('end', 0)}秒"
            beat = (b.get("beat") or "").strip()
            content = (b.get("content") or "").strip()
            if beat and content:
                lines.append(f"  {seg}（{beat}）：{content}")
            elif content:
                lines.append(f"  {seg}：{content}")
    return "\n".join(lines)


def _output_spec(opts: dict) -> str:
    spec = [f"竖屏9:16短视频，总时长约{opts.get('duration', 15)}秒。"]
    if opts.get("resolution"):
        spec.append("分辨率" + opts["resolution"] + "。")
    spec.append("电影级质感，生活流家庭短剧，克制叙事，温暖反转，浅景深，镜头平稳缓慢，人物表情自然，无生硬广告感。")
    return " ".join(spec)


def build_structured_prompt(cfg: dict) -> str:
    """结构化配置 -> 完整提示词
    cfg: {characters:[], scene:{}, product:{}, appear_way:'', template:{}, rhythm:{}, duration, resolution, ratio}
    """
    blocks = [SERIES_SETTING]
    characters = cfg.get("characters") or []
    if characters:
        blocks.append("人物设定：\n" + _persons_block(characters))
    scene = cfg.get("scene")
    if scene:
        blocks.append("场景设定：" + _scene_block(scene))
    product = cfg.get("product")
    if product:
        blocks.append(_product_block(product, cfg.get("appear_way", "")))
    template = cfg.get("template")
    if template:
        blocks.append(_template_block(template))
    rhythm = cfg.get("rhythm")
    if rhythm and (rhythm.get("segments") or []):
        lines = [f"视频节奏（{rhythm.get('name', '')}，总长{rhythm.get('duration', 15)}秒）："]
        for s in rhythm.get("segments") or []:
            lines.append(f"  第{s.get('start', 0)}至{s.get('end', 0)}秒：{s.get('purpose', '')}")
        blocks.append("\n".join(lines))
    blocks.append(_output_spec(cfg))
    return "\n\n".join(blocks)


def build_free_prompt(raw: str) -> str:
    """自由模式: 用户已给出完整提示词, 原样返回"""
    return (raw or "").strip()