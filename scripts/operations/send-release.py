#!/usr/bin/env python3
"""Sign release identity and upload the exact archive via a forced SSH command."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    target = os.environ['ORBIT_DEPLOY_TARGET']
    if not re.fullmatch(r'orbitdeploy@[A-Za-z0-9][A-Za-z0-9.-]*', target):
        raise ValueError('Invalid release receiver address')
    if args.probe:
        header = {'mode': 'probe', 'commit': '0' * 40, 'version': '0.0.0-000000.0000', 'sha256': '0' * 64,
                  'size': 1, 'run': 1, 'attempt': 1}
    else:
        inventory = json.loads(args.inventory.read_text())
        header = {'mode': 'deploy', 'commit': os.environ['GITHUB_SHA'], 'version': inventory['version'],
                  'sha256': inventory['sha256'], 'size': args.archive.stat().st_size,
                  'run': int(os.environ['GITHUB_RUN_NUMBER']), 'attempt': int(os.environ['GITHUB_RUN_ATTEMPT'])}
    with tempfile.TemporaryDirectory(prefix='orbit-cd-') as directory:
        work = Path(directory)
        for filename, name in [('ssh', 'ORBIT_DEPLOY_SSH_KEY'), ('signing', 'ORBIT_DEPLOY_SIGNING_KEY'),
                               ('known_hosts', 'ORBIT_DEPLOY_KNOWN_HOSTS')]:
            path = work / filename
            with open(path, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
                stream.write(os.environ[name].rstrip() + '\n')
        message = json.dumps(header, separators=(',', ':')).encode()
        (work / 'header').write_bytes(message)
        signature = subprocess.check_output(['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(work / 'signing'),
                                             '-in', str(work / 'header')], timeout=10)
        payload = json.dumps({'message': base64.b64encode(message).decode(), 'signature': base64.b64encode(signature).decode()})
        with subprocess.Popen(['ssh', '-F', '/dev/null', '-T', '-i', str(work / 'ssh'),
                               '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                               '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={work / "known_hosts"}',
                               '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
                               target], stdin=subprocess.PIPE) as client:
            try:
                client.stdin.write(payload.encode() + b'\n')
                client.stdin.flush()
                if args.archive:
                    with args.archive.open('rb') as archive:
                        while block := archive.read(1024 * 1024):
                            client.stdin.write(block)
                client.stdin.close()
            except BrokenPipeError:
                pass
            if client.wait() != 0:
                raise SystemExit('Orbit release receiver failed')


if __name__ == '__main__':
    main()
