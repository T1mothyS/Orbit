#!/usr/bin/env python3
"""Stage a verified Orbit Linux release and switch a single PM2 writer."""
import argparse
import os
if os.name == 'posix':
    import fcntl
import importlib.util
import json
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

sys_spec = importlib.util.spec_from_file_location('orbit_release_archive', Path(__file__).with_name('verify-release-archive.py'))
archive_spec = importlib.util.module_from_spec(sys_spec)
sys_spec.loader.exec_module(archive_spec)

MUTABLE = ('.env', 'data')
RESERVE = 512 * 1024**2


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf8', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def call(*args, timeout=35, cwd=None, env=None):
    return subprocess.run([str(value) for value in args], cwd=cwd, env=env, timeout=timeout,
                          capture_output=True, check=True).stdout


def move(source, target):
    if source.is_symlink() or not source.exists() or os.path.lexists(target):
        raise RuntimeError('RELEASE_MOVE_STATE_INVALID')
    source.rename(target)


def backup_bytes(current):
    total = 1024 * 1024
    inodes = 0
    for name in MUTABLE:
        path = current / name
        if path.is_symlink() or not path.exists():
            raise RuntimeError('RUNTIME_DATA_PATH_INVALID')
        if path.is_dir():
            for folder, dirs, files in os.walk(path, followlinks=False):
                for child in [*dirs, *files]:
                    info = (Path(folder) / child).lstat()
                    total += ((info.st_size + 511) // 512 + 2) * 512
                    inodes += 1
        else:
            total += ((path.stat().st_size + 511) // 512 + 2) * 512
    return total, inodes


def ensure_space(root, extra, entries):
    stats = os.statvfs(root)
    if stats.f_bavail * stats.f_frsize < extra or stats.f_favail < entries:
        raise RuntimeError('PRODUCTION_CAPACITY_INSUFFICIENT')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Runtime:
    def __init__(self, pm2, node, process, base, public_base=None):
        self.pm2 = pm2
        self.node = node
        self.process = process
        self.base = base
        self.public_base = public_base
        self.client = build_opener(ProxyHandler({}), NoRedirect())
        self.env = dict(os.environ)

    def pid(self):
        return call(self.pm2, 'pid', self.process, env=self.env).decode().strip().split()

    def stop(self):
        call(self.pm2, 'stop', self.process, env=self.env)
        if any(pid != '0' for pid in self.pid()):
            raise RuntimeError('PM2_WRITER_STILL_RUNNING')

    def restart(self, enabled=False):
        flags = {'ORBIT_PERFORMANCE_ENABLED': 'true', 'ORBIT_SYSTEM_ALERTS_ENABLED': 'true'}
        if not enabled:
            flags = {key: self.env.get(key, 'false') for key in flags}
        call(self.pm2, 'restart', self.process, '--update-env', env={**self.env, **flags})

    def get(self, path, limit=16 * 1024 * 1024, base=None):
        with self.client.open(Request((base or self.base) + path, headers={'Cache-Control': 'no-cache'}), timeout=5) as response:
            result = response.read(limit + 1)
            if len(result) > limit:
                raise RuntimeError('RELEASE_PROBE_TOO_LARGE')
            return response.headers.get('Content-Type', ''), result

    def verify_public(self, commit=None, version=None):
        if not self.public_base:
            return
        for attempt in range(3):
            try:
                path = '/api/ready' if commit else '/api/health'
                payload = json.loads(self.get(path, 4096, base=self.public_base)[1])
                if not commit and payload.get('status') == 'ok':
                    return
                if commit and (payload.get('status'), payload.get('commit'), payload.get('version')) == ('ready', commit, version):
                    return
            except (URLError, TimeoutError, ValueError, RuntimeError):
                pass
            if attempt < 2:
                time.sleep(2)
        raise RuntimeError('PUBLIC_READINESS_VERIFY_FAILED')

    def verify(self, root, commit=None, version=None):
        deadline = time.monotonic() + 55
        while True:
            try:
                path = '/api/ready' if commit else '/api/health'
                data = json.loads(self.get(path, 4096)[1])
                if commit and (data.get('status'), data.get('commit'), data.get('version')) != ('ready', commit, version):
                    raise RuntimeError('RELEASE_READY_IDENTITY_MISMATCH')
                if not commit and data.get('status') != 'ok':
                    raise RuntimeError('RELEASE_HEALTH_FAILED')
                break
            except (URLError, TimeoutError, ValueError, RuntimeError):
                if time.monotonic() > deadline:
                    raise
                time.sleep(1)
        pids = self.pid()
        if len(pids) != 1 or not re.fullmatch(r'[1-9]\d*', pids[0]):
            raise RuntimeError('PM2_WRITER_NOT_ONLINE')
        entry = (root / 'dist/index.html').read_bytes()
        for route in ('/', '/today', '/assistant'):
            mime, body = self.get(route)
            if 'text/html' not in mime or body != entry:
                raise RuntimeError('RELEASE_PAGE_VERIFY_FAILED')
        assets = set(re.findall(rb'(?:src|href)="(/assets/[A-Za-z0-9_.-]+\.(?:css|js))"', entry))
        if not any(name.endswith(b'.js') for name in assets):
            raise RuntimeError('RELEASE_ASSET_ENTRY_MISSING')
        for asset in assets:
            name = asset.decode()
            expected_type = 'javascript' if name.endswith('.js') else 'text/css'
            mime, body = self.get(name)
            if expected_type not in mime or body != (root / ('dist' + name)).read_bytes():
                raise RuntimeError('RELEASE_ASSET_VERIFY_FAILED')
        try:
            self.get('/api/notifications', 4096)
        except HTTPError as error:
            if error.code == 401:
                return
            raise
        raise RuntimeError('RELEASE_AUTH_BOUNDARY_FAILED')


def recover(runtime, current, rollback, staged, failed, previous_enabled):
    runtime.stop()
    if rollback.is_dir():
        donor = current if current.is_dir() else staged
        for name in MUTABLE:
            if not (rollback / name).exists():
                move(donor / name, rollback / name)
        if current.exists():
            move(current, failed)
        move(rollback, current)
    runtime.restart(enabled=previous_enabled)
    runtime.verify(current)
    runtime.verify_public()
    call(runtime.pm2, 'save', env=runtime.env)


def switch_release(runtime, current, rollback, staged, failed, backup_dir, metadata):
    journal = backup_dir / 'transaction.json'
    def phase(state):
        atomic_json(journal, {**metadata, 'phase': state})
        print('phase=' + state, flush=True)
    phase('prepared')
    try:
        runtime.stop()
        phase('stopped')
        backup = backup_dir / 'data-config.tar'
        fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        call('tar', '-cf', backup, '-C', current, *MUTABLE, timeout=120)
        with backup.open('rb') as stream:
            checksum = archive_spec.digest(stream)
            os.fsync(stream.fileno())
        members = call('tar', '-tf', backup, timeout=90).splitlines()
        if b'.env' not in members or not any(name.startswith(b'data/') for name in members):
            raise RuntimeError('COLD_BACKUP_INCOMPLETE')
        receipt = backup_dir / 'data-config.tar.sha256'
        receipt.write_text(checksum + '  data-config.tar\n')
        receipt.chmod(0o600)
        phase('backup-verified')
        move(current, rollback)
        for name in MUTABLE:
            move(rollback / name, staged / name)
        move(staged, current)
        phase('switched')
        runtime.restart(enabled=True)
        runtime.verify(current, metadata['commit'], metadata['version'])
        runtime.verify_public(metadata['commit'], metadata['version'])
        call(runtime.pm2, 'save', env=runtime.env)
        phase('success')
    except (Exception, KeyboardInterrupt):
        try:
            recover(runtime, current, rollback, staged, failed, metadata.get('previous_monitoring') is True)
            phase('rolled-back')
        except (Exception, KeyboardInterrupt):
            phase('rollback-failed')
            raise
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--current', type=Path, required=True)
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--backups', type=Path, required=True)
    parser.add_argument('--pm2', type=Path, required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--process', default='smart-schedule')
    parser.add_argument('--public-base')
    parser.add_argument('--port', default=3000, type=int)
    parser.add_argument('--id', required=True)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--commit')
    parser.add_argument('--version')
    parser.add_argument('--previous-commit')
    parser.add_argument('--ci-run', type=int)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'orbit-[A-Za-z0-9.-]{8,80}', args.id) or not 1 <= args.port <= 65535:
        parser.error('invalid release ID or port')
    if not all(path.is_absolute() and path.resolve() == path and path.is_dir()
               for path in (args.staging, args.backups, args.current.parent)):
        parser.error('use existing absolute roots without symlinks')
    if len({path.stat().st_dev for path in (args.current.parent, args.staging, args.backups)}) != 1:
        parser.error('switching requires a single filesystem')
    if args.public_base:
        public = urlsplit(args.public_base)
        if public.scheme != 'https' or not public.hostname or public.username or public.password or public.query or public.fragment or public.path:
            parser.error('public-base must be an HTTPS origin')
    runtime = Runtime(args.pm2, args.node, args.process, f'http://127.0.0.1:{args.port}', args.public_base)
    rollback = args.current.with_name(args.current.name + '.rollback-' + args.id)
    failed = args.current.with_name(args.current.name + '.failed-' + args.id)
    backup_dir = args.backups / args.id
    stage = args.staging / args.id
    staged = stage / archive_spec.ROOT
    if args.apply or args.recover:
        lock = os.open(args.current.parent, os.O_RDONLY | os.O_DIRECTORY)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.recover:
        journal = backup_dir / 'transaction.json'
        metadata = json.loads(journal.read_text())
        if metadata.get('release_id') != args.id or metadata.get('phase') not in ('prepared', 'stopped', 'backup-verified', 'switched', 'rollback-failed'):
            raise RuntimeError('RELEASE_TRANSACTION_NOT_RECOVERABLE')
        recover(runtime, args.current, rollback, staged, failed, metadata.get('previous_monitoring') is True)
        atomic_json(journal, {**metadata, 'phase': 'rolled-back'})
        return
    if not all(value is not None for value in (args.archive, args.sha256, args.commit, args.version)):
        parser.error('archive, sha256, commit and version are required')
    if any(os.path.lexists(path) for path in (rollback, failed, backup_dir, stage)):
        raise RuntimeError('RELEASE_ID_ALREADY_USED')
    if args.current.is_symlink() or not args.current.is_dir():
        raise RuntimeError('CURRENT_RELEASE_NOT_FOUND')
    deployed = json.loads((args.current / '.deploy').read_text())
    old_commit = deployed.get('commit') or deployed.get('base_commit')
    if not re.fullmatch(r'[a-f0-9]{40}', old_commit or ''):
        raise RuntimeError('CURRENT_RELEASE_COMMIT_UNKNOWN')
    if args.previous_commit and old_commit != args.previous_commit:
        raise RuntimeError('CURRENT_RELEASE_MOVED')
    app_pid = runtime.pid()
    if len(app_pid) != 1 or not re.fullmatch(r'[1-9]\d*', app_pid[0]):
        raise RuntimeError('SINGLE_PM2_WRITER_REQUIRED')
    actual_node = call(args.node, '--version').decode().strip()
    inventory = archive_spec.verify_archive(args.archive, args.sha256, args.commit, args.version)
    if inventory['node'] != actual_node:
        raise RuntimeError('LINUX_RUNTIME_NODE_MISMATCH')
    cold_bytes, _ = backup_bytes(args.current)
    ensure_space(args.staging, cold_bytes + inventory['estimatedBlockBytes'] + RESERVE, inventory['entries'] + 100)
    runtime.verify(args.current)
    runtime.verify_public()
    print(json.dumps({'archive': inventory, 'coldBackupBytes': cold_bytes, 'reserveBytes': RESERVE}), flush=True)
    if not args.apply:
        return
    stage.mkdir(mode=0o700)
    backup_dir.mkdir(mode=0o700)
    call('tar', '--extract', '--gzip', '--file', args.archive, '--directory', stage,
         '--no-same-owner', '--no-same-permissions', timeout=150)
    data, home = stage / 'data', stage / 'home'
    data.mkdir()
    home.mkdir()
    try:
        call(args.node, '--import', 'tsx', 'scripts/verify-linux-release.mjs', cwd=staged, timeout=105, env={
            'PATH': os.environ['PATH'], 'HOME': str(home), 'DATA_DIR': str(data),
            'APP_ENV': 'production', 'APP_URL': 'https://release-smoke.invalid',
            'JWT_SECRET': 'synthetic-release-smoke-only-not-a-secret',
            'ADMIN_INVITE_CODE': 'synthetic-release-admin-code', 'USER_INVITE_CODE': 'synthetic-release-user-code',
            'ORBIT_RELEASE_SMOKE': 'true', 'ORBIT_RELEASE_SMOKE_COMMIT': args.commit, 'BACKGROUND_JOBS_ENABLED': 'false',
            'ORBIT_PROACTIVE_ENABLED': 'false', 'ANDROID_PUSH_ENABLED': 'false',
        })
    finally:
        shutil.rmtree(data)
        shutil.rmtree(home)
    cold_bytes, _ = backup_bytes(args.current)
    ensure_space(args.staging, cold_bytes + RESERVE, 100)
    metadata = {'commit': args.commit, 'base_commit': args.commit, 'previous_commit': old_commit, 'version': args.version, 'release_id': args.id,
                'previous_monitoring': bool(deployed.get('ci_run')), 'package_sha256': args.sha256, 'rollback': str(rollback), 'backup': str(backup_dir / 'data-config.tar')}
    if args.ci_run:
        metadata['ci_run'] = args.ci_run
    atomic_json(staged / '.deploy', metadata)
    switch_release(runtime, args.current, rollback, staged, failed, backup_dir, metadata)
    stage.rmdir()


def interrupt(signum, frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupt)
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        if isinstance(error, RuntimeError):
            print(str(error))
        else:
            print(type(error).__name__)
        raise SystemExit(1)
