#!/usr/bin/env python3
"""Read-only capacity check for an already measured release plan."""

import argparse
import json
import os
from pathlib import Path

REQUIRED = {'archive', 'expanded', 'backup', 'temporary', 'reserve'}


def check_capacity(plan):
    if not isinstance(plan, dict) or plan.get('version') != 1:
        raise ValueError('PLAN_VERSION_REQUIRED')
    allocations = plan.get('allocations')
    if not isinstance(allocations, dict) or not REQUIRED.issubset(allocations):
        raise ValueError('CAPACITY_INPUTS_INCOMPLETE')
    previous = plan.get('previousRelease')
    if not isinstance(previous, str) or not Path(previous).is_absolute() or not Path(previous).is_dir():
        raise ValueError('PREVIOUS_RELEASE_UNVERIFIED')
    groups = {}
    for name, allocation in allocations.items():
        if not isinstance(allocation, dict):
            raise ValueError('INVALID_ALLOCATION')
        directory, size, inodes = (allocation.get(key) for key in ('directory', 'bytes', 'inodes'))
        if not isinstance(directory, str) or not Path(directory).is_absolute() or not Path(directory).is_dir():
            raise ValueError('MEASURED_DIRECTORY_REQUIRED')
        minimum = 0 if name == 'temporary' else 1
        if type(size) is not int or type(inodes) is not int or size < minimum or inodes < minimum:
            raise ValueError('MEASURED_ALLOCATION_REQUIRED')
        device = os.stat(directory).st_dev
        stats = os.statvfs(directory)
        if stats.f_frsize <= 0 or stats.f_blocks <= 0 or stats.f_files <= 0:
            raise ValueError('FILESYSTEM_CAPACITY_UNAVAILABLE')
        available_bytes = stats.f_bavail * stats.f_frsize
        available_inodes = stats.f_favail
        group = groups.setdefault(device, {
            'allocations': [], 'requiredBytes': 0, 'requiredInodes': 0,
            'availableBytes': available_bytes, 'availableInodes': available_inodes,
        })
        group['allocations'].append(name)
        group['requiredBytes'] += size
        group['requiredInodes'] += inodes
        group['availableBytes'] = min(group['availableBytes'], available_bytes)
        group['availableInodes'] = min(group['availableInodes'], available_inodes)
    for group in groups.values():
        group['sufficient'] = (group['requiredBytes'] <= group['availableBytes']
                               and group['requiredInodes'] <= group['availableInodes'])
    return {'sufficient': all(group['sufficient'] for group in groups.values()), 'mounts': list(groups.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    args = parser.parse_args()
    try:
        result = check_capacity(json.loads(args.plan.read_text(encoding='utf-8')))
    except ValueError as error:
        print(json.dumps({'sufficient': False, 'reason': str(error)}))
        return 2
    except OSError:
        print(json.dumps({'sufficient': False, 'reason': 'CAPACITY_READ_FAILED'}))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result['sufficient'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
