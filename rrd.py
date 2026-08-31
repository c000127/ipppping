import os


def find_rrd(data_dir, category, target, slave=None):
    filename = f"{target}~{slave}.rrd" if slave else f"{target}.rrd"
    path = os.path.join(data_dir, category, filename)
    return path if os.path.exists(path) else None
