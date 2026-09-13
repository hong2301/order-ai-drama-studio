# -*- coding: utf-8 -*-
"""统一日志模块(参考「微信公众号ocr采集器」backend/app/core/logkit.py 同构)

设计要点:
  - 单入口: get_logger(name) —— 业务代码一律由此取日志(替代 print/裸 logging)
  - 三文件(由本模块维护, 轮转): run.log(业务) / api.log(接口) / error.log(ERROR汇总)
  - 唯一出口: 正常函数一律走 logger, 消除裸输出
  - 异步写盘: 日志先入内存队列, 后台线程统一落盘(QueueHandler+QueueListener), 不卡业务主流程
  - 统一格式: 时间 [级别] 线程 模块.函数 消息(不含 logger 名, uvicorn.error 之类字样不再出现)
  - 前缀路由: 按 logger 名分流 —— drama.* 与 root 进 run.log; uvicorn.*/api.* 进 api.log
  - 接口日志: api_log_middleware(FastAPI) 记 方法 路径 状态 耗时 -> api.log(健康轮询端点跳过)
  - 前端上报: handle_frontend_report() 收前端崩溃现场 -> error.log
  - 动态级别: set_level() 运行时调节(排查用, 无需重启)
  - reload 双进程: reloader 父进程不持有文件句柄(见 setup 判定), 避免轮转 rename 被占用
"""
import logging
import logging.handlers
import os
import queue
import sys
import threading
import time as _time

from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler

_LOG_MAX = 10 * 1024 * 1024            # run/api 单文件上限
_LOG_KEEP = 3
_ERR_MAX = 2 * 1024 * 1024

_FMT = "%(asctime)s [%(levelname)s] %(threadName)s %(module)s.%(funcName)s %(message)s"

_started = False
_listener = None                       # QueueListener 后台写盘线程
_lock = threading.Lock()


def get_logger(name):
    """全项目唯一取日志入口; name 建议子域: drama.db / drama.main / drama.pipeline ..."""
    return logging.getLogger(name)


class _PrefixFilter(logging.Filter):
    """按 logger name 前缀路由(空串=无前缀 root 日志)"""
    def __init__(self, names):
        self._names = tuple(names)

    def filter(self, rec):
        return any(rec.name == n or rec.name.startswith(n + ".") for n in self._names)


def _file_handlers(logdir, fmt):
    """三文件 handler(run/api 分流; error 全量 ERROR)"""
    run_h = RotatingFileHandler(os.path.join(logdir, "run.log"),
                                maxBytes=_LOG_MAX, backupCount=_LOG_KEEP, encoding="utf-8")
    run_h.setLevel(logging.INFO)
    run_h.setFormatter(fmt)
    run_h.addFilter(_PrefixFilter(("drama", "")))     # 业务日志: drama.* 与 root
    api_h = RotatingFileHandler(os.path.join(logdir, "api.log"),
                                maxBytes=_LOG_MAX, backupCount=_LOG_KEEP, encoding="utf-8")
    api_h.setLevel(logging.INFO)
    api_h.setFormatter(fmt)
    api_h.addFilter(_PrefixFilter(("uvicorn.error", "uvicorn.startup", "api")))  # 请求行由中间件记(避免与 uvicorn.access 重复)
    err_h = RotatingFileHandler(os.path.join(logdir, "error.log"),
                                maxBytes=_ERR_MAX, backupCount=2, encoding="utf-8")
    err_h.setLevel(logging.ERROR)
    err_h.setFormatter(fmt)
    return run_h, api_h, err_h


def setup(enable_files=None):
    """初始化日志体系(幂等)。
    enable_files=None 时自动判定: 打包单进程/reload spawn子进程 -> 开文件;
    dev reload 的 reloader 父进程 -> 只终端不碰文件(避免轮转 rename 冲突)。
    """
    global _started, _listener
    with _lock:
        if _started:
            return
        _started = True                 # 先标记避免竞态, 后续失败由调用方负责(不重置, 避免风暴)
    logdir = os.path.join(_data_dir(), "logs")
    try:
        os.makedirs(logdir, exist_ok=True)
    except Exception:
        logdir = ""

    if enable_files is None:
        import multiprocessing as _mp
        spawn_child = _mp.parent_process() is not None
        dev_reload = os.environ.get("APP_DEV_RELOAD") == "1"
        enable_files = (not dev_reload) or spawn_child

    root = logging.getLogger()
    fmt = logging.Formatter(_FMT, "%H:%M:%S")
    root.setLevel(logging.INFO)
    root.handlers[:] = []

    # 1) 文件链路: Queue -> QueueListener(异步落盘)
    if enable_files and logdir:
        run_h, api_h, err_h = _file_handlers(logdir, fmt)
        q = queue.Queue(-1)
        _listener = QueueListener(q, run_h, api_h, err_h, respect_handler_level=True)
        _listener.start()
        root.addHandler(QueueHandler(q))

    # 2) 终端可见(dev 终端; 打包版无终端则丢弃, 以文件为准)
    try:
        csh = logging.StreamHandler(sys.stderr)
        csh.setFormatter(fmt)
        csh.addFilter(_PrefixFilter(("uvicorn", "api", "")))
        root.addHandler(csh)
    except Exception:
        pass

    # 3) uvicorn.access 健康轮询不刷屏
    class _Slim(logging.Filter):
        def filter(self, rec):
            return "health" not in rec.getMessage()
    try:
        logging.getLogger("uvicorn.access").addFilter(_Slim())
    except Exception:
        pass


def _data_dir():
    from ..database import data_dir
    return data_dir()


# ================= 动态级别 =================

def set_level(name="", level=logging.INFO):
    """运行时调整某个 logger 级别(为空=root), 排查用无需重启"""
    logging.getLogger(name).setLevel(level)


# ================= 接口日志中间件 =================

# 高频健康轮询端点(前端轮询, 无日志价值), 跳过记录防止刷屏 api.log
_SKIP_PATHS = ("/api/health",)


async def api_log_middleware(request, call_next):
    """记录每个接口: 方法 路径 状态 耗时(ms) -> api.log(健康轮询端点跳过)"""
    if request.url.path in _SKIP_PATHS:
        return await call_next(request)
    api = get_logger("api.request")
    t0 = _time.perf_counter()
    try:
        resp = await call_next(request)
    except Exception:
        dur = (_time.perf_counter() - t0) * 1000
        api.error("EXC %s %s %.0fms src=%s", request.method, request.url.path,
                  dur, request.client.host if request.client else "?")
        raise
    dur = (_time.perf_counter() - t0) * 1000
    api.info("%s %s -> %d %.0fms src=%s", request.method, request.url.path,
             resp.status_code, dur, request.client.host if request.client else "?")
    return resp


# ================= 前端错误上报 =================

def handle_frontend_report(payload):
    """前端渲染进程崩溃现场 -> error.log(frontend 域)"""
    get_logger("frontend").error("前端上报: %s", str(payload)[:2000])