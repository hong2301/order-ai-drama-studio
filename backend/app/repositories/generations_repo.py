# -*- coding: utf-8 -*-
"""生成记录数据访问层(generations 表)"""
import json
from ..database import get_conn


def _row_to_dict(r):
    d = dict(r)
    try:
        d["extra"] = json.loads(d.get("extra") or "{}")
    except Exception:
        d["extra"] = {}
    return d


def list_generations(limit: int = 50) -> list:
    conn = get_conn()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM generations ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
    finally:
        conn.close()
    return [_row_to_dict(r) for r in rows]


def get_generation(gid: int):
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM generations WHERE id=?", (gid,)).fetchone()
    finally:
        conn.close()
    return _row_to_dict(r) if r else None


def create(p: dict) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO generations(mode,title,prompt,model_id,status,duration,resolution,ratio,seed,extra) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (p.get("mode", "structured"), p.get("title", ""), p.get("prompt", ""),
             p.get("model_id", ""), p.get("status", "draft"),
             p.get("duration", 5), p.get("resolution", "720p"), p.get("ratio", "9:16"),
             p.get("seed", -1), json.dumps(p.get("extra") or {}, ensure_ascii=False)))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_status(gid: int, status: str, **fields) -> None:
    """更新状态与可选字段(任务id/视频url/本地路径/token/错误)"""
    conn = get_conn()
    try:
        sets = ["status=?", "updated_at=datetime('now','localtime')"]
        vals = [status]
        for k in ("task_id", "video_url", "local_path", "seed", "error"):
            if k in fields:
                sets.append(f"{k}=?")
                vals.append(fields[k])
        conn.execute(f"UPDATE generations SET {', '.join(sets)} WHERE id=?", (*vals, gid))
        conn.commit()
    finally:
        conn.close()


def delete(gid: int) -> bool:
    conn = get_conn()
    try:
        cur = conn.execute("DELETE FROM generations WHERE id=?", (gid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()