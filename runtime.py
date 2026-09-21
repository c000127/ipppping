"""Bounded, dependency-free runtime primitives for the small API server."""
import functools
import sys
import threading
import time
from collections import OrderedDict, deque


def object_size(value):
    seen = set()

    def size(item):
        if id(item) in seen:
            return 0
        seen.add(id(item))
        total = sys.getsizeof(item)
        if isinstance(item, dict):
            total += sum(size(k) + size(v) for k, v in item.items())
        elif isinstance(item, (list, tuple)):
            total += sum(size(v) for v in item)
        return total

    return size(value)


class BoundedCache:
    """TTL + LRU, bounded by entry count and estimated Python object bytes."""
    def __init__(self, max_entries, max_bytes):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.entries = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()

    def clear(self):
        with self.lock:
            self.entries.clear()
            self.bytes = 0

    def _remove(self, key):
        self.bytes -= self.entries.pop(key)[2]

    def _expire(self, now):
        for key, (expires, _, _) in list(self.entries.items()):
            if expires <= now:
                self._remove(key)

    def get_value(self, key):
        with self.lock:
            self._expire(time.monotonic())
            entry = self.entries.get(key)
            if entry is None:
                return None
            self.entries.move_to_end(key)
            return entry[1]

    def put(self, key, value, ttl):
        size = object_size((key, value))
        with self.lock:
            now = time.monotonic()
            self._expire(now)
            if key in self.entries:
                self._remove(key)
            if size > self.max_bytes:
                return
            while self.entries and (len(self.entries) >= self.max_entries or self.bytes + size > self.max_bytes):
                self._remove(next(iter(self.entries)))
            self.entries[key] = (now + ttl, value, size)
            self.bytes += size


def serialized_keys(function):
    """Fixed-size striped locks coalesce identical concurrent cache misses."""
    locks = [threading.Lock() for _ in range(64)]

    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        key = repr((args, sorted(kwargs.items())))
        with locks[hash(key) % len(locks)]:
            return function(*args, **kwargs)
    return wrapped


def windowed_map(executor, function, items, window):
    """At most window submitted futures per caller, not one per matrix pair."""
    iterator = iter(items)
    pending = deque()
    try:
        for _ in range(window):
            item = next(iterator, None)
            if item is None:
                break
            pending.append(executor.submit(function, item))
        while pending:
            yield pending.popleft().result()
            item = next(iterator, None)
            if item is not None:
                pending.append(executor.submit(function, item))
    finally:
        for future in pending:
            future.cancel()
