# -*- coding: utf-8 -*-
"""AI模型配置数据访问层(ai_config 表)"""
import json
from ..database import get_conn


def _row_to_dict(r):
    d = dict(r)
    try:
        d["capability"] = json.loads(d.get("capability") or "{}")
    except Exception:
        d["capability"] = {}
    return d


def list_configs(enabled_only: bool = False) -> list:
    conn = get_conn()
    try:
        sql = "SELECT * FROM ai_config"
        if enabled_only:
            sql += " WHERE enabled=1"
        sql += " ORDER BY sort_order, id"
        rows = [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()
    return [_row_to_dict(r) for r in rows]


def get_config(cid: int):
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM ai_config WHERE id=?", (cid,)).fetchone()
    finally:
        conn.close()
    return _row_to_dict(r) if r else None


def get_by_model_id(model_id: str):
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM ai_config WHERE model_id=? AND enabled=1", (model_id,)).fetchone()
    finally:
        conn.close()
    return _row_to_dict(r) if r else None


def create(payload: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO ai_config(name,provider,api_key,model_id,kind,capability,cost_note,desc,enabled,sort_order) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (payload.get("name", ""), payload.get("provider", "doubao"), payload.get("api_key", ""),
             payload.get("model_id", ""), payload.get("kind", "video"),
             json.dumps(payload.get("capability") or {}, ensure_ascii=False),
             payload.get("cost_note", ""), payload.get("desc", ""),
             1 if payload.get("enabled", True) else 0, payload.get("sort_order", 999)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update(cid: int, payload: dict) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM ai_config WHERE id=?", (cid,))
        if cur.fetchone() is None:
            return False
        conn.execute(
            "UPDATE ai_config SET name=?,provider=?,api_key=?,model_id=?,kind=?,capability=?,cost_note=?,desc=?,enabled=?,sort_order=? WHERE id=?",
            (payload.get("name"), payload.get("provider", "doubao"), payload.get("api_key", ""),
             payload.get("model_id"), payload.get("kind", "video"),
             json.dumps(payload.get("capability") or {}, ensure_ascii=False),
             payload.get("cost_note", ""), payload.get("desc", ""),
             1 if payload.get("enabled", True) else 0, payload.get("sort_order", 999), cid))
        conn.commit()
        return True
    finally:
        conn.close()


def delete(cid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM ai_config WHERE id=?", (cid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()