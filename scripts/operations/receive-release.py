#!/usr/bin/env python3
"""Receive an independently signed release over a forced-command SSH account."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile

from importlib import import_module

deployment = import_module('deploy-release')
MAX_BYTES = 1024**3


def read_header(stream, signing_key, work):
    line = stream.readline(4097)
    if not line.endswith(b'\n') or len(line) > 4096:
        raise ValueError('invalid release header')
    envelope = json.loads(line)
    if not isinstance(envelope, dict) or set(envelope) != {'message', 'signature'}:
        raise ValueError('invalid release envelope')
    message = base64.b64decode(envelope['message'], validate=True)
    signature = base64.b64decode(envelope['signature'], validate=True)
    if len(signature) != 64:
        raise ValueError('invalid signature')
    (work / 'header').write_bytes(message)
    (work / 'signature').write_bytes(signature)
    deployment.call('/usr/bin/openssl', 'pkeyutl', '-verify', '-rawin', '-pubin', '-inkey', signing_key,
                    '-in', work / 'header', '-sigfile', work / 'signature')
    header = json.loads(message)
    if not isinstance(header, dict) or set(header) != {'mode', 'commit', 'version', 'sha256', 'size', 'run', 'attempt'}:
        raise ValueError('invalid release metadata')
    if header['mode'] not in ('deploy', 'probe'):
        raise ValueError('invalid release mode')
    for name, pattern in [('commit', r'[a-f0-9]{40}'), ('version', r'\d+\.\d+\.\d+-\d{6}\.\d{4}'), ('sha256', r'[a-f0-9]{64}')]:
        if not isinstance(header[name], str) or not re.fullmatch(pattern, header[name]):
            raise ValueError('invalid release metadata')
    for name, maximum in [('size', MAX_BYTES), ('run', 2**31 - 1), ('attempt', 99)]:
        if type(header[name]) is not int or not 1 <= header[name] <= maximum:
            raise ValueError('invalid release metadata')
    return header


def receive(stream, target, header):
    checksum = hashlib.sha256()
    pending = header['size']
    with target.open('xb') as output:
        while pending:
            block = stream.read(min(pending, 1024 * 1024))
            if not block:
                raise ValueError('incomplete release transfer')
            output.write(block)
            checksum.update(block)
            pending -= len(block)
        output.flush()
        os.fsync(output.fileno())
    if checksum.hexdigest() != header['sha256']:
        raise ValueError('release transfer checksum mismatch')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('current', 'staging', 'backups', 'pm2', 'node', 'signing-key'):
        parser.add_argument('--' + option, type=Path, required=True)
    parser.add_argument('--public-base', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    stream = sys.stdin.buffer
    signal.alarm(20)
    with tempfile.TemporaryDirectory(prefix='orbit-cd-header-') as directory:
        header = read_header(stream, args.signing_key, Path(directory))
    signal.alarm(0)
    if header['mode'] == 'probe':
        print('Orbit release receiver verified signed probe')
        return
    with (args.staging / '.ci-receive.lock').open('ab') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = json.loads((args.current / '.deploy').read_text())
        previous = current.get('commit') or current.get('base_commit')
        prior_run = current.get('ci_run')
        if prior_run and header['run'] <= prior_run:
            raise RuntimeError('CI_RELEASE_ALREADY_APPLIED_OR_STALE')
        if previous == header['commit']:
            if current.get('version') != header['version']:
                raise RuntimeError('CI_RELEASE_IDENTITY_MISMATCH')
            print('Orbit is already serving this release')
            return
        identifier = f"orbit-ci-{header['run']}-{header['attempt']}-{header['commit'][:12]}"
        cold_bytes, _ = deployment.backup_bytes(args.current)
        deployment.ensure_space(args.staging, header['size'] + cold_bytes + deployment.RESERVE, 200)
        print('capacity available for transfer', flush=True)
        with tempfile.TemporaryDirectory(prefix=identifier + '-', dir=args.staging) as directory:
            archive = Path(directory) / 'release.tgz'
            signal.alarm(30 * 60)
            receive(stream, archive, header)
            signal.alarm(0)
            options = [
                '--current', args.current, '--staging', args.staging, '--backups', args.backups,
                '--pm2', args.pm2, '--node', args.node, '--id', identifier, '--public-base', args.public_base,
                '--archive', archive, '--sha256', header['sha256'], '--commit', header['commit'],
                '--version', header['version'], '--previous-commit', previous, '--ci-run', header['run'], '--apply',
            ]
            subprocess.run(['/usr/bin/python3', '-B', str(Path(__file__).with_name('deploy-release.py')),
                            *map(str, options)], stdin=subprocess.DEVNULL, check=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, RuntimeError) else type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
