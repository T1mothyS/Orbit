#!/usr/bin/env python3
"""Take a bounded, read-only Linux resource sample and emit JSON."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time


def optional(read):
    try:
        return read()
    except (OSError, ValueError, IndexError, KeyError, StopIteration):
        return None


def cpu_counters(text):
    fields = next(line.split()[1:] for line in text.splitlines() if line.startswith('cpu '))
    return tuple(map(int, fields[:8])) if len(fields) >= 8 else None


def named_numbers(text, names):
    result = {}
    for line in text.splitlines():
        words = line.split()
        if not words or words[0].rstrip(':') not in names:
            continue
        result[words[0].rstrip(':')] = int(words[1])
    return result


def disk_counters(text, device):
    for line in text.splitlines():
        fields = line.split()
        if len(fields) >= 14 and tuple(map(int, fields[:2])) == device:
            return tuple(int(fields[index]) for index in (3, 7, 6, 10, 12))
    return None


def pressure_avg10(text):
    for line in text.splitlines():
        if line.startswith('some '):
            token = next(word for word in line.split() if word.startswith('avg10='))
            return float(token.split('=', 1)[1])
    return None


def delta(before, after):
    if before is None or after is None or len(before) != len(after):
        return None
    values = tuple(end - start for start, end in zip(before, after))
    return values if all(value >= 0 for value in values) else None


def window(before, after, seconds, page_size):
    result = {'cpu': None, 'paging': None, 'disk': None}
    cpu = delta(before['cpu'], after['cpu'])
    if cpu and sum(cpu) > 0:
        total = sum(cpu)
        result['cpu'] = {
            'busyPercent': round(100 * (total - cpu[3] - cpu[4] - cpu[7]) / total, 2),
            'ioWaitPercent': round(100 * cpu[4] / total, 2),
            'stealPercent': round(100 * cpu[7] / total, 2),
        }
    paging = delta(before['paging'], after['paging'])
    if paging is not None:
        result['paging'] = {'swapInBytes': paging[0]*page_size, 'swapOutBytes': paging[1]*page_size}
    disk = delta(before['disk'], after['disk'])
    if disk is not None:
        reads, writes, read_ms, write_ms, busy_ms = disk
        result['disk'] = {
            'readsPerSecond': round(reads / seconds, 2), 'writesPerSecond': round(writes / seconds, 2),
            'meanReadMs': round(read_ms / reads, 2) if reads else None,
            'meanWriteMs': round(write_ms / writes, 2) if writes else None,
            'activePercent': round(min(100, busy_ms / (10 * seconds)), 2),
        }
    return result


def take_sample(path, seconds, proc=Path('/proc')):
    def text(filename):
        return (proc / filename).read_text()

    mount = os.stat(path).st_dev
    device = (os.major(mount), os.minor(mount))

    def counters():
        def paging():
            values = named_numbers(text('vmstat'), {'pswpin', 'pswpout'})
            return values['pswpin'], values['pswpout']
        return {'cpu': optional(lambda: cpu_counters(text('stat'))), 'paging': optional(paging),
                'disk': optional(lambda: disk_counters(text('diskstats'), device))}

    start = time.monotonic()
    before = counters()
    time.sleep(seconds)
    after = counters()
    elapsed = time.monotonic() - start
    mem = optional(lambda: named_numbers(text('meminfo'), {'MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'})) or {}
    stats = os.statvfs(path)
    return {
        'observedAt': datetime.now(timezone.utc).isoformat(),
        'windowSeconds': round(elapsed, 3),
        'memoryBytes': {name: mem[name]*1024 if name in mem else None
                        for name in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree')},
        'pressureAvg10Percent': {name: optional(lambda: pressure_avg10(text('pressure/' + name)))
                                 for name in ('cpu', 'memory', 'io')},
        'filesystem': {'totalBytes': stats.f_blocks*stats.f_frsize,
                       'availableBytes': stats.f_bavail*stats.f_frsize,
                       'availableInodes': stats.f_favail if stats.f_files > 0 else None},
        **window(before, after, elapsed, os.sysconf('SC_PAGE_SIZE')),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--path', default='/')
    parser.add_argument('--seconds', type=float, default=1)
    args = parser.parse_args()
    if not 0.25 <= args.seconds <= 30:
        parser.error('seconds must be between 0.25 and 30')
    if not Path('/proc').is_dir():
        parser.error('Linux /proc is required')
    print(json.dumps(take_sample(args.path, args.seconds)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
