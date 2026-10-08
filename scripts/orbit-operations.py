"""Orbit controlled operations. CLI only; never exposed to AI/HTTP.

Default maintenance is a dry run. Configuration and state live outside releases.
No business-data traversal, arbitrary commands, or implicit legacy success import.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from functools import lru_cache

CHECKS = ('packageHash', 'backup', 'deploymentMetadata', 'process', 'health', 'homepage', 'today', 'staticAssets', 'rollbackMaterials', 'protectedTools')
SERVICES = ('main', 'shadow')
WORKERS = {'openai-proxy': 'orbit-openai-proxy.service', 'media-proxy': 'digest-media-proxy.service'}
LOG_SUFFIX = re.compile(r'(?:\.log(?:\.\d+)?|\.(?:out|err)|\.(?:out|err)\.\d+)(?:\.gz)?$')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')

def timestamp(value):
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError, TypeError):
        return 0

def code(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', value) else 'UNCLASSIFIED_ERROR'

def read(file, fallback):
    try:
        if file.is_symlink() or file.stat().st_size > 2_000_000:
            return fallback
        return json.loads(file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return fallback

def atomic(file, value):
    if has_link(file) or has_link(file.with_suffix('.pending')):
        raise ValueError('STATE_FILE_SYMLINK')
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.pending')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.chmod(temporary, 0o600)
    os.replace(temporary, file)

def ledger_read(state):
    file = state / 'deployments.json'
    value = read(file, None) if file.exists() else {'records': []}
    if not isinstance(value, dict) or not isinstance(value.get('records'), list) or any(not isinstance(r,dict) or not r.get('id') or r.get('service') not in SERVICES for r in value['records']):
        raise ValueError('DEPLOYMENT_LEDGER_INVALID')
    return value

def has_link(file):
    return any(p.is_symlink() for p in (file, *file.parents))

@contextlib.contextmanager
def lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    if has_link(directory):
        raise ValueError('STATE_PATH_SYMLINK')
    if has_link(directory / 'operations.lock'):
        raise ValueError('LOCK_SYMLINK')
    with (directory / 'operations.lock').open('a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            handle.seek(0); handle.write(b'0'); handle.flush(); handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)

def load_config(file):
    config = read(Path(file), None)
    if not isinstance(config, dict) or set(config.get('services', {})) - set(SERVICES) or set(config.get('workers', {})) - set(WORKERS):
        raise ValueError('INVALID_CONFIG')
    state = Path(config['stateDir'])
    if not state.is_absolute() or has_link(state):
        raise ValueError('INVALID_STATE_PATH')
    for service in config['services'].values():
        root = Path(service['releaseRoot'])
        current = Path(service['currentPath'])
        if not root.is_absolute() or not current.is_absolute() or has_link(root):
            raise ValueError('INVALID_RELEASE_ROOT')
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{3,100}', service['releasePrefix']):
            raise ValueError('INVALID_RELEASE_PREFIX')
        if state.resolve().is_relative_to(root.resolve()) or root.resolve().is_relative_to(state.resolve()):
            raise ValueError('STATE_MUST_BE_OUTSIDE_RELEASE_ROOT')
    return config

def release_path(service, value, allow_current=False):
    file = Path(value)
    root = Path(service['releaseRoot']).resolve()
    if not file.is_absolute() or has_link(file) or file.resolve().parent != root:
        raise ValueError('UNSAFE_RELEASE_PATH')
    if allow_current and file.resolve() == Path(service['currentPath']).resolve():
        return file
    if not file.name.startswith(service['releasePrefix']) or file.name == service['releasePrefix']:
        raise ValueError('UNSAFE_RELEASE_NAME')
    return file

def sha(file):
    info = file.stat()
    return cached_sha(str(file), info.st_size, info.st_mtime_ns)

@lru_cache(maxsize=100)
def cached_sha(file, size, modified):
    digest = hashlib.sha256()
    with Path(file).open('rb') as handle:
        for part in iter(lambda: handle.read(1024*1024), b''):
            digest.update(part)
    return digest.hexdigest()

def dependency_hash(directory):
    package = read(directory / 'package.json', {})
    declaration = read(directory / 'package-lock.json', {})
    if not package.get('dependencies') or not declaration.get('packages'):
        raise ValueError('DEPENDENCY_DECLARATION_MISSING')
    # Release timestamps/versions are not dependency identities.
    declaration.pop('version', None)
    declaration['packages'].get('', {}).pop('version', None)
    canonical = {'dependencies': package['dependencies'], 'lock': declaration}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def reference_ok(value):
    file = Path(value or '')
    return file.is_absolute() and file.is_file() and not has_link(file)

def recovery_ready(record):
    recovery = record.get('recovery') or {}
    directory = Path(record['path'])
    if record.get('status') != 'success' or not all(record.get('checks', {}).get(c) is True for c in CHECKS):
        return False
    if not (directory / 'server').is_dir() or not (directory / 'dist/index.html').is_file():
        return False
    if read(directory / 'package.json', {}).get('version') != record.get('version'):
        return False
    if not reference_ok(recovery.get('configRef')) or not reference_ok(recovery.get('dataRecoveryRef')):
        return False
    try:
        if dependency_hash(directory) != recovery.get('dependencyHash'):
            return False
        runtime = recovery.get('runtime') or {}
        if runtime.get('kind') == 'archive':
            return reference_ok(runtime.get('path')) and sha(Path(runtime['path'])) == runtime.get('sha256') and runtime.get('platform') == 'linux'
        source = Path(runtime.get('path', ''))
        manifest = read(source.parent / '.release-manifest.json', {})
        return source.name == 'node_modules' and source.is_dir() and not has_link(source) and manifest.get('platform') == 'linux' and manifest.get('arch') == 'x64' and dependency_hash(source.parent) == recovery['dependencyHash']
    except (OSError, ValueError, KeyError):
        return False

def active_under(directory):
    """Protect cwd/executable/open files of every process. Incomplete visibility fails closed."""
    if not Path('/proc').is_dir():
        return True  # Applying release deletion is Linux-only.
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            targets = [entry / 'cwd', entry / 'exe', *(entry / 'fd').iterdir()]
            for target in targets:
                try:
                    resolved = Path(os.readlink(target))
                    if resolved.is_absolute() and resolved.is_relative_to(directory.resolve()):
                        return True
                except FileNotFoundError:
                    pass  # A process can exit between reads.
                except OSError:
                    if target.name in ('cwd', 'exe'):
                        return True
        except PermissionError:
            return True
        except FileNotFoundError:
            pass
    return False

def releases_plan(config, ledger):
    deletes, warnings = [], []
    records = ledger.get('records', [])
    for name, service in config['services'].items():
        current = Path(service['currentPath']).resolve()
        eligible = []
        seen = set()
        for record in sorted(records, key=lambda r: timestamp(r.get('finishedAt')), reverse=True):
            if record.get('service') != name or record.get('prunedAt') or not record.get('path'):
                continue
            if Path(record['path']).resolve() == current:
                continue
            try:
                directory = release_path(service, record['path'])
            except ValueError:
                warnings.append({'id': record.get('id'), 'code': 'UNSAFE_RELEASE_PATH'}); continue
            if directory.resolve() == current or str(directory) in seen:
                continue
            seen.add(str(directory))
            if recovery_ready(record):
                eligible.append(record)
            elif directory.exists():
                warnings.append({'id': record.get('id'), 'code': 'RECOVERY_UNVERIFIED'})
        for record in eligible[10:]:
            directory = Path(record['path'])
            # Shared dependencies protect their owning release even when it exceeds ten slots.
            shared = any(r.get('service') == name and r.get('path') != str(directory) and not r.get('prunedAt') and (r.get('recovery', {}).get('runtime', {}).get('kind') == 'directory') and Path(r['recovery']['runtime']['path']).is_relative_to(directory) for r in records if r.get('status') == 'success')
            if shared or active_under(directory):
                warnings.append({'id': record['id'], 'code': 'SHARED_RUNTIME_PROTECTED' if shared else 'ACTIVE_OR_UNOBSERVED_PROCESS'}); continue
            # No release with business directories is ever eligible for recursive deletion.
            if any(p.name in ('data', 'backups', 'attachments', 'media', '.env', 'knowledge') or p.suffix in ('.db', '.sqlite', '.sqlite3') for p in directory.rglob('*') if not p.is_relative_to(directory / 'node_modules')):
                warnings.append({'id': record['id'], 'code': 'BUSINESS_OR_CONFIG_PATH_PROTECTED'}); continue
            deletes.append({'id': record['id'], 'service': name, 'path': str(directory)})
    return deletes, warnings

def log_files(config):
    files = {}
    for group in config.get('logs', []):
        root = Path(group['root'])
        if not root.is_absolute() or has_link(root):
            raise ValueError('UNSAFE_LOG_ROOT')
        for name in group.get('active', []):
            if Path(name).name != name or not LOG_SUFFIX.search(name):
                raise ValueError('INVALID_LOG_NAME')
            file = root / name
            if file.exists() and file.is_file() and not has_link(file):
                files[str(file)] = (file, True)
        for pattern in group.get('archives', []):
            # Explicit basenames only. Never enumerate unrelated files/subdirectories.
            if '/' in pattern or '\\' in pattern or '**' in pattern or pattern.startswith('*'):
                raise ValueError('INVALID_LOG_PATTERN')
            for file in root.glob(pattern):
                if file.is_file() and not has_link(file) and LOG_SUFFIX.search(file.name):
                    files.setdefault(str(file), (file, False))
    return list(files.values())

def logs_plan(config):
    files = log_files(config)
    total = sum(f.stat().st_size for f, _ in files)
    trigger = 300 * 1024 * 1024
    target = 225 * 1024 * 1024
    remaining, deletes = total, []
    if total > trigger:
        for file, active in sorted(files, key=lambda pair: (pair[0].stat().st_mtime, str(pair[0]))):
            if active or active_under(file):
                continue
            size = file.stat().st_size
            deletes.append({'path': str(file), 'bytes': size}); remaining -= size
            if remaining <= target:
                break
    return {'bytes': total, 'projectedBytes': remaining, 'triggerBytes': trigger, 'targetBytes': target,
            'delete': deletes, 'capacityWarning': total > trigger and remaining > target}

def collect(config):
    services, errors = [], []
    observed = now()
    entries = list(config['services'].items()) + [(name, {'systemdUnit':WORKERS[name], **value}) for name,value in config.get('workers', {}).items()]
    for name, service in entries:
        state, health = 'unobserved', 'unobserved'
        unit = service.get('systemdUnit')
        if unit and re.fullmatch(r'(?:digest-shadow|orbit-openai-proxy|digest-media-proxy)\.service', unit):
            try:
                result = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, timeout=10, text=True)
                state = result.stdout.strip() if result.stdout.strip() in ('active', 'inactive', 'failed', 'activating') else 'unobserved'
            except (OSError, subprocess.TimeoutExpired):
                pass
        elif name == 'main' and service.get('pm2Process') == 'smart-schedule':
            try:
                result = subprocess.run(['pm2', 'pid', 'smart-schedule'], capture_output=True, timeout=10, text=True)
                state = 'active' if result.returncode == 0 and any(line.isdigit() and int(line)>0 and Path('/proc', line).exists() for line in result.stdout.splitlines()) else 'inactive'
            except (OSError, subprocess.TimeoutExpired):
                pass
        # Loopback HTTP health only, no authentication secrets or arbitrary network target.
        url = service.get('healthUrl', '')
        if re.fullmatch(r'http://127\.0\.0\.1:\d{2,5}/api/health', url):
            try:
                with urllib.request.build_opener(NoRedirect()).open(url, timeout=5) as response:
                    health = 'responding' if response.status == 200 else 'failed'
            except Exception:
                health = 'failed'
        deployed = read(Path(service['currentPath']) / '.deploy', {}) if service.get('currentPath') else {}
        package = read(Path(service['currentPath']) / 'package.json', {}) if service.get('currentPath') else {}
        services.append({'service': name, 'state': state, 'health': health, 'version': package.get('version'), 'commit': deployed.get('commit') or deployed.get('base_commit')})
        if state == 'failed' or state == 'inactive' and service.get('expectedActive') is True:
            errors.append({'at':observed,'service':name,'code':'SERVICE_NOT_ACTIVE'})
        if health == 'failed': errors.append({'at':observed,'service':name,'code':'HEALTH_CHECK_FAILED'})
    return {'observedAt': observed, 'services': services, 'errors': errors}

def maintenance(config, apply=False):
    state = Path(config['stateDir'])
    with lock(state):
        ledger = ledger_read(state)
        if any(r.get('status') == 'running' for r in ledger['records']):
            return {'applied': False, 'code': 'DEPLOYMENT_IN_PROGRESS'}
        releases, warnings = releases_plan(config, ledger)
        logs = logs_plan(config)
        if apply:
            rotation = Path(config.get('logrotateConfig', ''))
            if rotation.is_absolute() and rotation.is_file() and not has_link(rotation) and os.name != 'nt':
                arguments = ['/usr/sbin/logrotate', '--state', str(state / 'logrotate.state'), str(rotation)]
                if logs['bytes'] > logs['triggerBytes']:
                    arguments.insert(1, '--force')
                result = subprocess.run(arguments, capture_output=True, timeout=60)
                if result.returncode:
                    warnings.append({'code': 'LOGROTATE_FAILED'})
                logs = logs_plan(config)
        failures = []
        if apply:
            for item in releases:
                try:
                    # Re-check under the shared lock immediately before deletion.
                    fresh, _ = releases_plan(config, ledger)
                    if item not in fresh:
                        raise ValueError('RELEASE_CHANGED_DURING_CLEANUP')
                    shutil.rmtree(item['path'])
                    for record in ledger['records']:
                        if record.get('path') == item['path']:
                            record['prunedAt'] = now(); record['rollbackReady'] = False
                except (OSError, ValueError):
                    failures.append({'id': item['id'], 'code': 'RELEASE_CLEANUP_FAILED'})
            for item in logs['delete']:
                try:
                    file = Path(item['path'])
                    current = dict((str(f), active) for f, active in log_files(config))
                    if current.get(str(file), True) or has_link(file) or active_under(file) or file.stat().st_size != item['bytes']:
                        raise ValueError('LOG_CHANGED_OR_PROTECTED')
                    file.unlink()
                except (OSError, ValueError):
                    failures.append({'code': 'LOG_CLEANUP_FAILED'})
            # Failure tombstones may remain, but private failure evidence expires after seven days.
            for record in ledger['records']:
                if record.get('status') == 'failed' and timestamp(record.get('finishedAt')) < dt.datetime.now().timestamp() - 7*86400:
                    record.pop('errorCode', None); record.pop('failureStage', None)
            atomic(state / 'deployments.json', ledger)
            snapshot = collect(config)
            after = logs_plan(config)
            snapshot['retention'] = {'observedAt': now(), 'managedLogBytes': after['bytes'], 'capacityWarning': logs['capacityWarning'] or after['capacityWarning'], 'warnings': warnings + failures}
            atomic(state / 'status.json', snapshot)
        return {'applied': apply, 'releases': releases, 'logs': logs, 'warnings': warnings, 'failures': failures}

def record(config, evidence):
    state = Path(config['stateDir'])
    service = evidence.get('service')
    if service not in config['services'] or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', evidence.get('id', '')):
        raise ValueError('INVALID_DEPLOYMENT_RECORD')
    if evidence.get('status') not in ('running', 'success', 'failed', 'rolled_back', 'unverified'):
        raise ValueError('INVALID_DEPLOYMENT_STATE')
    with lock(state):
        ledger = ledger_read(state)
        old = next((r for r in ledger['records'] if r['id'] == evidence['id'] and r['service'] == service), None)
        item = {key: evidence[key] for key in ('id', 'service', 'status', 'version', 'commit', 'path', 'checks', 'recovery') if key in evidence}
        if item.get('path'):
            release_path(config['services'][service], item['path'], allow_current=True)
        item['startedAt'] = old.get('startedAt') if old else evidence.get('startedAt') or now()
        if item['status'] != 'running':
            item['finishedAt'] = evidence.get('finishedAt') or (old.get('finishedAt') if old and old['status']==item['status'] else None) or now()
        if item['status'] == 'success' and not all(item.get('checks', {}).get(c) is True for c in CHECKS):
            raise ValueError('DEPLOYMENT_ACCEPTANCE_INCOMPLETE')
        if item['status'] == 'failed':
            item.update(errorCode=code(evidence.get('errorCode')), failureStage=code(evidence.get('failureStage')))
        item['rollbackReady'] = recovery_ready(item) if item.get('path') else False
        ledger['records'] = [r for r in ledger['records'] if not (r['id'] == item['id'] and r['service'] == service)] + [item]
        atomic(state / 'deployments.json', ledger)
    return {'id': item['id'], 'status': item['status'], 'rollbackReady': item['rollbackReady']}

def freeze_runtime(config, service_name, source):
    """Freeze the only dependency source before pruning it; excludes code/config/data."""
    service = config['services'][service_name]
    source = release_path(service, source)
    manifest = read(source / '.release-manifest.json', {})
    if manifest.get('platform') != 'linux' or manifest.get('arch') != 'x64':
        raise ValueError('LINUX_RUNTIME_UNVERIFIED')
    modules = source / 'node_modules'
    if not modules.is_dir() or has_link(modules):
        raise ValueError('RUNTIME_MISSING')
    for file in modules.rglob('*'):
        if file.is_symlink() and not file.resolve().is_relative_to(modules.resolve()):
            raise ValueError('EXTERNAL_RUNTIME_SYMLINK')
    digest = dependency_hash(source)
    state = Path(config['stateDir'])
    with lock(state):
        ledger = ledger_read(state)
        if any(r.get('status') == 'running' for r in ledger['records']):
            raise ValueError('DEPLOYMENT_IN_PROGRESS')
        destination = state / 'runtimes' / (digest + '.tar.gz')
        if has_link(destination):
            raise ValueError('UNSAFE_RUNTIME_ARCHIVE')
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix('.pending')
        with tarfile.open(temporary, 'w:gz', dereference=False) as archive:
            archive.add(modules, arcname='node_modules')
        os.replace(temporary, destination)
        runtime = {'kind': 'archive', 'path': str(destination), 'sha256': sha(destination), 'platform': 'linux'}
        for item in ledger['records']:
            recovery = item.get('recovery', {})
            if recovery.get('dependencyHash') == digest and recovery.get('runtime', {}).get('path') == str(modules):
                recovery['runtime'] = runtime
                item['rollbackReady'] = recovery_ready(item)
        atomic(state / 'deployments.json', ledger)
    return {'dependencyHash': digest, 'runtime': runtime}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    maintenance_parser = commands.add_parser('maintain')
    maintenance_parser.add_argument('--apply', action='store_true')
    record_parser = commands.add_parser('record'); record_parser.add_argument('--evidence', required=True); record_parser.add_argument('--apply-retention', action='store_true')
    commands.add_parser('snapshot')
    runtime_parser = commands.add_parser('freeze-runtime'); runtime_parser.add_argument('--service', choices=SERVICES, required=True); runtime_parser.add_argument('--source', required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    if args.command == 'maintain':
        result = maintenance(config, args.apply)
    elif args.command == 'record':
        result = record(config, read(Path(args.evidence), {}))
        if result['status'] == 'success':
            result['retention'] = maintenance(config, args.apply_retention)
    elif args.command == 'freeze-runtime':
        result = freeze_runtime(config, args.service, args.source)
    else:
        with lock(Path(config['stateDir'])):
            result = collect(config); atomic(Path(config['stateDir']) / 'status.json', result)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
        print(json.dumps({'error': 'OPERATIONS_PREFLIGHT_FAILED'}), file=sys.stderr)
        sys.exit(1)
