import json
from pathlib import Path


def load_nodes(path):
    nodes = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("node configuration must be a non-empty list")
    ids = set()
    required = {"id", "label", "v4", "v6", "group", "region"}
    for node in nodes:
        if not isinstance(node, dict) or not required <= node.keys():
            raise ValueError("each node must contain id, label, v4, v6, group and region")
        if node["id"] in ids or node["group"] not in {"vps", "dns"}:
            raise ValueError("node ids must be unique and groups must be vps or dns")
        ids.add(node["id"])
    return nodes
