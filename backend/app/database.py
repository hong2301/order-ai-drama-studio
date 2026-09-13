# -*- coding: utf-8 -*-
"""SQLite 数据库: 连接 + 建表 + 种子数据

表清单:
  settings         key-value 全局设置
  ai_config        AI模型配置(豆包chat/视频生成), 含能力/费用展示字段
  characters       固定人物表(<<嘴硬家属>>系列人物)
  products         产品表(枸杞原浆/益生菌/益生元等)
  scenes           场景表(家庭/玄关/厨房等)
  story_templates  文本模板表(故事线/冲突/分秒节拍/示例提示词)
  video_rhythms    视频节奏表(15秒结构分段)
  generations      生成记录表(任务/成品/本地路径)

约定沿用参考项目: 单文件 data/drama.db; 一次启动集中建表; WAL 并发
"""
import json
import logging
import os
import sqlite3

log = logging.getLogger("drama.db")

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DATA_DIR = os.environ.get("DRAMA_DATA_DIR") or os.path.join(_BASE, "data")
DB_PATH = os.path.join(_DATA_DIR, "drama.db")
VIDEO_DIR = os.path.join(_DATA_DIR, "videos")


def data_dir():
    return _DATA_DIR


def videos_dir():
    return VIDEO_DIR


def get_conn():
    os.makedirs(_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass
    return conn


# ================= 种子数据(来源: 客户方案文档) =================

SEED_CHARACTERS = [
    # name, family_role, age, profession, traits, look
    ("老周", "爸爸", 48, "销售经理", "经常应酬，话少，不会表达", "深色夹克、公文包"),
    ("林慧", "妈妈", 46, "行政主管", "爱念叨，操心全家", "米色针织衫、购物袋"),
    ("周晴", "姐姐", 26, "职场女性", "已经工作，正在谈恋爱", "通勤风格"),
    ("陈屿", "周晴男朋友", 28, "程序员", "老实稳重，表达笨拙", "休闲格子衫"),
    ("周小满", "弟弟", 19, "大学生", "嘴上嫌父母唠叨，心里惦记家人", "大学生卫衣、双肩包"),
    ("周妈", "奶奶", 71, "退休在家", "节俭，舍不得给自己花钱", "朴素老人装、老花镜"),
    ("老刘", "刘叔", 49, "老周老朋友", "热情，常约老周聚餐", "爽朗中年男"),
    ("林芳", "大姨", 50, "个体经营者", "爽朗热心，负责调解家庭矛盾", "干练中年女性"),
]

SEED_PRODUCTS = [
    # name, category, fit_persons(JSON), appear_ways(JSON), desc
    ("枸杞原浆", "养生饮品", ["林慧", "周晴", "周妈", "老周"],
     ["放进冰箱里并留下一张纸条", "放进早餐或外卖旁边", "悄悄塞进行李箱"],
     "适合操劳、加班、出差、子女关心长辈；不编造治疗效果"),
    ("益生菌", "益生菌", ["老周", "周晴", "陈屿"],
     ["放进背包侧袋", "放进出差行李箱"],
     "适合聚餐、出差、饮食不规律场景"),
    ("益生元", "益生元", ["老周", "周晴", "陈屿"],
     ["放进丈夫的背包", "放在电脑旁"],
     "适合聚餐、出差、饮食不规律场景"),
    ("维生素类", "维生素", ["职场人物", "大学生", "父母"],
     ["放在早餐旁", "放进返校行李箱", "放在玄关"],
     "适合早餐、返校、换季、家庭准备"),
    ("中老年营养品", "中老年营养品", ["老周", "林慧", "周妈"],
     ["子女送父母", "节日礼盒放在茶几"],
     "适合子女送父母、节日、日常陪伴"),
]

SEED_SCENES = [
    # name, location, desc, atmosphere, timing
    ("玄关换鞋", "家门口玄关", "丈夫弯腰系鞋带，妻子递包", "生活、克制", "傍晚"),
    ("客厅沙发", "家中客厅", "下班回家、休息、拌嘴", "暖色调、放松", "傍晚至夜晚"),
    ("厨房冰箱", "家中厨房", "丈夫放枸杞原浆、贴纸条；妻子开冰箱发现", "温暖、柔和", "傍晚"),
    ("浴室洗漱", "家中卫生间", "妻子洗漱，丈夫悄悄下单", "日常、安静", "夜晚"),
    ("餐桌边", "家中餐厅", "家庭聚餐、吃火锅烧烤、摆早餐", "热闹或温馨", "任意"),
    ("门口送别", "家门口", "出门上班、出差、孩子返校", "惦记、牵挂", "清晨"),
    ("通勤路上", "街道/地铁", "上班路上、接电话", "城市感", "白天"),
    ("卧室床边", "卧室", "睡前聊天、留东西", "私密、温柔", "夜晚"),
]

SEED_TEMPLATES = [
    # name, story_line, relation_hint, conflict, beats(JSON), example, seed_prompt
    ("火锅烧烤聚餐款", "中年夫妻", "老周与林慧",
     "丈夫总跟朋友吃火锅烧烤，顿顿重口，妻子埋怨",
     [{"start": 0, "end": 4, "beat": "情绪钩子", "content": "丈夫在玄关换鞋，妻子埋怨：总跟朋友吃火锅烧烤，顿顿重口"},
      {"start": 4, "end": 8, "beat": "嘴硬回应", "content": "丈夫苦笑：人到中年，有些人情局推不掉"},
      {"start": 8, "end": 12, "beat": "关心反转", "content": "妻子趁丈夫系鞋带，把益生元悄悄放进背包侧袋"},
      {"start": 12, "end": 15, "beat": "情感收尾", "content": "妻子递包：给你放这，多留心自己。字幕：中年夫妻，唠叨也是惦记"}],
     "第0至4秒：丈夫站在玄关换鞋。妻子埋怨说，总跟朋友吃火锅烧烤，顿顿重口。第4至8秒：丈夫苦笑说，人到中年，有些人情局推不掉。第8至12秒：妻子趁丈夫系鞋带，把益生元悄悄放进背包侧袋。第12至15秒：妻子把包递过去说，给你放这，多留心自己。字幕出现，中年夫妻，唠叨也是惦记。",
     "中年夫妻，玄关，丈夫应酬多总吃火锅烧烤，妻子念叨；妻子悄悄把益生元放进丈夫背包侧袋；结尾字幕：中年夫妻，唠叨也是惦记。"),
    ("枸杞原浆关心款", "中年夫妻", "老周与林慧",
     "妻子下班疲惫，丈夫看见但没有说话，默默下单",
     [{"start": 0, "end": 4, "beat": "情绪钩子", "content": "妻子下班回家，神情疲惫；丈夫看见后没有说话"},
      {"start": 4, "end": 8, "beat": "嘴硬回应", "content": "妻子转身洗漱，丈夫悄悄拿出手机下单"},
      {"start": 8, "end": 12, "beat": "关心反转", "content": "第二天，妻子在冰箱里发现枸杞原浆，旁边写着记得喝"},
      {"start": 12, "end": 15, "beat": "情感收尾", "content": "丈夫一边穿鞋一边说：顺手买的，别多想。字幕：生活细碎里，藏着不动声色的温柔"}],
     "第0至4秒：妻子下班回家，神情疲惫。丈夫看见后没有说话。第4至8秒：妻子转身洗漱，丈夫悄悄拿出手机下单。第8至12秒：第二天，妻子在冰箱里发现枸杞原浆，旁边写着记得喝。第12至15秒：丈夫一边穿鞋一边说，顺手买的，别多想。字幕出现，生活细碎里，藏着不动声色的温柔。",
     "中年夫妻，妻子下班疲惫回家，丈夫沉默地拿出手机下单枸杞原浆放进冰箱贴纸条；妻子开冰箱发现后微笑；丈夫门口穿鞋说：顺手买的，别多想。结尾字幕：生活细碎里，藏着不动声色的温柔。"),
]

SEED_RHYTHMS = [
    # name, duration, desc, segments(JSON)
    ("标准15秒结构", 15, "情绪钩子→嘴硬回应→关心反转→情感收尾",
     [{"start": 0, "end": 4, "beat": "情绪钩子", "purpose": "出现埋怨、误会或家庭小冲突"},
      {"start": 4, "end": 8, "beat": "嘴硬回应", "purpose": "对方解释、回避或继续顶嘴"},
      {"start": 8, "end": 12, "beat": "关心反转", "purpose": "通过一个动作表达关心，产品自然出现"},
      {"start": 12, "end": 15, "beat": "情感收尾", "purpose": "一句克制对白，加一条系列字幕"}]),
]

SEED_AI_CONFIGS = [
    # name, provider, model_id, kind, capability, cost_note, desc
    ("豆包 Seedance 1.0 Pro Fast", "doubao", "doubao-seedance-1-0-pro-fast-251015",
     "video",
     {"durations": [5, 10], "resolutions": ["720p", "1080p"], "ratios": ["9:16", "16:9"],
      "fps": 24, "watermark": True},
     "按生成秒数与分辨率计费；Fast版出片快",
     "文字/图生视频，快速出片，已验证可用(本账号已开通)"),
    ("豆包 Seedance 1.0 Pro", "doubao", "doubao-seedance-1-0-pro-250528",
     "video",
     {"durations": [5, 10], "resolutions": ["720p", "1080p"], "ratios": ["9:16", "16:9"],
      "fps": 24, "watermark": True},
     "按生成秒数与分辨率计费；标准版画质更好",
     "文字/图生视频，标准出片质量"),
    ("豆包 Seed 2.0 Mini (文本)", "doubao", "doubao-seed-2-0-mini-260428",
     "chat",
     {"context": "multi-modal", "responses": True},
     "文本/多模态对话，按 token 计费",
     "用于模型连接测试与提示词扩写等文本能力"),
]


def init_db():
    os.makedirs(VIDEO_DIR, exist_ok=True)
    conn = get_conn()
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS ai_config (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            provider   TEXT DEFAULT 'doubao',
            api_key    TEXT DEFAULT '',
            model_id   TEXT NOT NULL,
            kind       TEXT DEFAULT 'video',   -- video | chat | image
            capability TEXT DEFAULT '{}',      -- JSON: 支持参数(时长/分辨率/比例等)
            cost_note  TEXT DEFAULT '',
            desc       TEXT DEFAULT '',
            enabled    INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS characters (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            family_role TEXT DEFAULT '',
            age         INTEGER DEFAULT 0,
            profession  TEXT DEFAULT '',
            traits      TEXT DEFAULT '',
            look        TEXT DEFAULT '',
            active      INTEGER DEFAULT 1,
            sort_order  INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            category    TEXT DEFAULT '',
            fit_persons TEXT DEFAULT '[]',   -- JSON 数组
            appear_ways TEXT DEFAULT '[]',   -- JSON 数组
            desc        TEXT DEFAULT '',
            active      INTEGER DEFAULT 1,
            sort_order  INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS scenes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            location    TEXT DEFAULT '',
            desc        TEXT DEFAULT '',
            atmosphere  TEXT DEFAULT '',
            timing      TEXT DEFAULT '',
            active      INTEGER DEFAULT 1,
            sort_order  INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS story_templates (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            story_line   TEXT DEFAULT '',
            relation_hint TEXT DEFAULT '',
            conflict     TEXT DEFAULT '',
            beats        TEXT DEFAULT '[]',  -- JSON: 分秒节拍
            example      TEXT DEFAULT '',
            seed_prompt  TEXT DEFAULT '',
            active       INTEGER DEFAULT 1,
            sort_order   INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS video_rhythms (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT NOT NULL,
            duration INTEGER DEFAULT 15,
            desc     TEXT DEFAULT '',
            segments TEXT DEFAULT '[]',   -- JSON: [{start,end,beat,purpose}]
            active   INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS generations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            mode        TEXT DEFAULT 'structured',  -- structured | free
            title       TEXT DEFAULT '',
            prompt      TEXT DEFAULT '',
            model_id    TEXT DEFAULT '',
            status      TEXT DEFAULT 'draft',  -- draft|queued|running|succeeded|failed|downloaded
            task_id     TEXT DEFAULT '',
            video_url   TEXT DEFAULT '',
            local_path  TEXT DEFAULT '',
            duration    INTEGER DEFAULT 5,
            resolution  TEXT DEFAULT '720p',
            ratio       TEXT DEFAULT '9:16',
            seed        INTEGER DEFAULT -1,
            extra       TEXT DEFAULT '{}',  -- JSON: characters/products/scenes/template/rhythm/segments
            error       TEXT DEFAULT '',
            created_at  TEXT DEFAULT (datetime('now','localtime')),
            updated_at  TEXT DEFAULT (datetime('now','localtime'))
        );
        """)
        _seed_catalog(conn)
        conn.commit()
    finally:
        conn.close()
    log.info("init_db done: %s", DB_PATH)


def _seed_catalog(conn):
    """字典档种子数据(幂等: 表空则写入)"""
    if conn.execute("SELECT COUNT(*) FROM characters").fetchone()[0] == 0:
        for i, (n, r, a, p, t, l) in enumerate(SEED_CHARACTERS):
            conn.execute("INSERT INTO characters(name,family_role,age,profession,traits,look,sort_order) VALUES(?,?,?,?,?,?,?)",
                         (n, r, a, p, t, l, i))
    if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        for i, (n, c, fp, aw, d) in enumerate(SEED_PRODUCTS):
            conn.execute("INSERT INTO products(name,category,fit_persons,appear_ways,desc,sort_order) VALUES(?,?,?,?,?,?)",
                         (n, c, json.dumps(fp, ensure_ascii=False), json.dumps(aw, ensure_ascii=False), d, i))
    if conn.execute("SELECT COUNT(*) FROM scenes").fetchone()[0] == 0:
        for i, (n, loc, d, at, tm) in enumerate(SEED_SCENES):
            conn.execute("INSERT INTO scenes(name,location,desc,atmosphere,timing,sort_order) VALUES(?,?,?,?,?,?)",
                         (n, loc, d, at, tm, i))
    if conn.execute("SELECT COUNT(*) FROM story_templates").fetchone()[0] == 0:
        for i, (n, sl, rh, cf, beats, ex, sp) in enumerate(SEED_TEMPLATES):
            conn.execute("INSERT INTO story_templates(name,story_line,relation_hint,conflict,beats,example,seed_prompt,sort_order) VALUES(?,?,?,?,?,?,?,?)",
                         (n, sl, rh, cf, json.dumps(beats, ensure_ascii=False), ex, sp, i))
    if conn.execute("SELECT COUNT(*) FROM video_rhythms").fetchone()[0] == 0:
        for i, (n, dur, d, segs) in enumerate(SEED_RHYTHMS):
            conn.execute("INSERT INTO video_rhythms(name,duration,desc,segments,sort_order) VALUES(?,?,?,?,?)",
                         (n, dur, d, json.dumps(segs, ensure_ascii=False), i))
    if conn.execute("SELECT COUNT(*) FROM ai_config").fetchone()[0] == 0:
        key = os.environ.get("DOUBAO_API_KEY", "")
        for i, (n, prov, mid, kind, cap, cost, d) in enumerate(SEED_AI_CONFIGS):
            conn.execute("INSERT INTO ai_config(name,provider,api_key,model_id,kind,capability,cost_note,desc,sort_order) VALUES(?,?,?,?,?,?,?,?,?)",
                         (n, prov, key, mid, kind, json.dumps(cap, ensure_ascii=False), cost, d, i))