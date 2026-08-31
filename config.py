import logging
import os
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = os.environ.get("IPPPING_DATA_DIR", "/home/smokeping/data")
HOST = os.environ.get("IPPPING_HOST", "127.0.0.1")
PORT = int(os.environ.get("IPPPING_PORT", "8082"))
TIMEZONE = os.environ.get("IPPPING_TIMEZONE", "Asia/Shanghai")
ALLOWED_DURATIONS = {3600, 10800, 21600, 86400}
ALLOWED_TYPES = {"v4", "v6"}
ALLOWED_THEMES = {"dark", "light"}
MAX_GRAPH_WORKERS = int(os.environ.get("IPPPING_MAX_GRAPH_WORKERS", "4"))
GRAPH_CACHE_TTL = int(os.environ.get("IPPPING_GRAPH_CACHE_TTL", "30"))
STATS_CACHE_TTL = int(os.environ.get("IPPPING_STATS_CACHE_TTL", "15"))
MAX_SELECTED_NODES = int(os.environ.get("IPPPING_MAX_SELECTED_NODES", "20"))
MAX_PAIRS = int(os.environ.get("IPPPING_MAX_PAIRS", "500"))
WEB_DIR = BASE_DIR / "web"
NODES_CONFIG = Path(os.environ.get("IPPPING_NODES_CONFIG", BASE_DIR / "config" / "nodes.json"))

logging.basicConfig(
    level=os.environ.get("IPPPING_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
LOG = logging.getLogger("ipppping")
GRAPH_SEMAPHORE = threading.BoundedSemaphore(MAX_GRAPH_WORKERS)
CACHE_LOCK = threading.Lock()
GRAPH_CACHE = {}
STATS_CACHE = {}
