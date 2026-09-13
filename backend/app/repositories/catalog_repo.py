# -*- coding: utf-8 -*-
"""字典档数据访问层: 人物/产品/场景/文本模板/视频节奏

统一约定: JSON 列(如 fit_persons/beats/segments)读取时解析为 Python 对象
"""
import json
from ..database import get_conn


def _parse(row, json_cols: tuple):
    d = dict(row)
    for c in json_cols:
        try:
            d[c] = json.loads(d.get(c) or "[]")
        except Exception:
            d[c] = []
    return d


# ---------- 人物 ----------
def list_characters(active_only: bool = False) -> list:
    conn = get_conn()
    try:
        sql = "SELECT * FROM characters"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY sort_order, id"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


def create_character(p: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO characters(name,family_role,age,profession,traits,look,active,sort_order) VALUES(?,?,?,?,?,?,?,?)",
            (p.get("name"), p.get("family_role", ""), p.get("age", 0), p.get("profession", ""),
             p.get("traits", ""), p.get("look", ""), 1 if p.get("active", True) else 0, p.get("sort_order", 999)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_character(cid: int, p: dict) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM characters WHERE id=?", (cid,))
        if cur.fetchone() is None:
            return False
        conn.execute("UPDATE characters SET name=?,family_role=?,age=?,profession=?,traits=?,look=?,active=? WHERE id=?",
                     (p.get("name"), p.get("family_role", ""), p.get("age", 0), p.get("profession", ""),
                      p.get("traits", ""), p.get("look", ""), 1 if p.get("active", True) else 0, cid))
        conn.commit()
        return True
    finally:
        conn.close()


def delete_character(cid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM characters WHERE id=?", (cid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------- 产品 ----------
def list_products(active_only: bool = False) -> list:
    conn = get_conn()
    try:
        sql = "SELECT * FROM products"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY sort_order, id"
        rows = []
        for r in conn.execute(sql).fetchall():
            rows.append(_parse(r, ("fit_persons", "appear_ways")))
        return rows
    finally:
        conn.close()


def create_product(p: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO products(name,category,fit_persons,appear_ways,desc,active,sort_order) VALUES(?,?,?,?,?,?,?)",
            (p.get("name"), p.get("category", ""),
             json.dumps(p.get("fit_persons") or [], ensure_ascii=False),
             json.dumps(p.get("appear_ways") or [], ensure_ascii=False),
             p.get("desc", ""), 1 if p.get("active", True) else 0, p.get("sort_order", 999)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_product(pid: int, p: dict) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM products WHERE id=?", (pid,))
        if cur.fetchone() is None:
            return False
        conn.execute("UPDATE products SET name=?,category=?,fit_persons=?,appear_ways=?,desc=?,active=? WHERE id=?",
                     (p.get("name"), p.get("category", ""),
                      json.dumps(p.get("fit_persons") or [], ensure_ascii=False),
                      json.dumps(p.get("appear_ways") or [], ensure_ascii=False),
                      p.get("desc", ""), 1 if p.get("active", True) else 0, pid))
        conn.commit()
        return True
    finally:
        conn.close()


def delete_product(pid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM products WHERE id=?", (pid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------- 场景 ----------
def list_scenes(active_only: bool = False) -> list:
    conn = get_conn()
    try:
        sql = "SELECT * FROM scenes"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY sort_order, id"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


def create_scene(p: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO scenes(name,location,desc,atmosphere,timing,active,sort_order) VALUES(?,?,?,?,?,?,?)",
            (p.get("name"), p.get("location", ""), p.get("desc", ""), p.get("atmosphere", ""),
             p.get("timing", ""), 1 if p.get("active", True) else 0, p.get("sort_order", 999)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_scene(sid: int, p: dict) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM scenes WHERE id=?", (sid,))
        if cur.fetchone() is None:
            return False
        conn.execute("UPDATE scenes SET name=?,location=?,desc=?,atmosphere=?,timing=?,active=? WHERE id=?",
                     (p.get("name"), p.get("location", ""), p.get("desc", ""), p.get("atmosphere", ""),
                      p.get("timing", ""), 1 if p.get("active", True) else 0, sid))
        conn.commit()
        return True
    finally:
        conn.close()


def delete_scene(sid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM scenes WHERE id=?", (sid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------- 文本模板 ----------
def list_templates(active_only: bool = False) -> list:
    conn = get_conn()
    try:
        sql = "SELECT * FROM story_templates"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY sort_order, id"
        rows = []
        for r in conn.execute(sql).fetchall():
            rows.append(_parse(r, ("beats",)))
        return rows
    finally:
        conn.close()


def get_template(tid: int):
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM story_templates WHERE id=?", (tid,)).fetchone()
        return _parse(r, ("beats",)) if r else None
    finally:
        conn.close()


def create_template(p: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO story_templates(name,story_line,relation_hint,conflict,beats,example,seed_prompt,active,sort_order) VALUES(?,?,?,?,?,?,?,?,?)",
            (p.get("name"), p.get("story_line", ""), p.get("relation_hint", ""), p.get("conflict", ""),
             json.dumps(p.get("beats") or [], ensure_ascii=False), p.get("example", ""),
             p.get("seed_prompt", ""), 1 if p.get("active", True) else 0, p.get("sort_order", 999)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_template(tid: int, p: dict) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM story_templates WHERE id=?", (tid,))
        if cur.fetchone() is None:
            return False
        conn.execute("UPDATE story_templates SET name=?,story_line=?,relation_hint=?,conflict=?,beats=?,example=?,seed_prompt=?,active=? WHERE id=?",
                     (p.get("name"), p.get("story_line", ""), p.get("relation_hint", ""), p.get("conflict", ""),
                      json.dumps(p.get("beats") or [], ensure_ascii=False), p.get("example", ""),
                      p.get("seed_prompt", ""), 1 if p.get("active", True) else 0, tid))
        conn.commit()
        return True
    finally:
        conn.close()


def delete_template(tid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM story_templates WHERE id=?", (tid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ---------- 视频节奏 ----------
def list_rhythms(active_only: bool = False) -> list:
    conn = get_conn()
    try:
        sql = "SELECT * FROM video_rhythms"
        if active_only:
            sql += " WHERE active=1"
        sql += " ORDER BY sort_order, id"
        rows = []
        for r in conn.execute(sql).fetchall():
            rows.append(_parse(r, ("segments",)))
        return rows
    finally:
        conn.close()


def get_rhythm(rid: int):
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM video_rhythms WHERE id=?", (rid,)).fetchone()
        return _parse(r, ("segments",)) if r else None
    finally:
        conn.close()


def create_rhythm(p: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO video_rhythms(name,duration,desc,segments,active,sort_order) VALUES(?,?,?,?,?,?)",
            (p.get("name"), p.get("duration", 15), p.get("desc", ""),
             json.dumps(p.get("segments") or [], ensure_ascii=False),
             1 if p.get("active", True) else 0, p.get("sort_order", 999)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_rhythm(rid: int, p: dict) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM video_rhythms WHERE id=?", (rid,))
        if cur.fetchone() is None:
            return False
        conn.execute("UPDATE video_rhythms SET name=?,duration=?,desc=?,segments=?,active=? WHERE id=?",
                     (p.get("name"), p.get("duration", 15), p.get("desc", ""),
                      json.dumps(p.get("segments") or [], ensure_ascii=False),
                      1 if p.get("active", True) else 0, rid))
        conn.commit()
        return True
    finally:
        conn.close()


def delete_rhythm(rid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM video_rhythms WHERE id=?", (rid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()