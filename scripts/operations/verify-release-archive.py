#!/usr/bin/env python3
"""Verify a frozen Linux Orbit archive without extracting it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import stat
import tarfile

ROOT = 'smart-schedule-agent'
MANIFEST = '.release-manifest.json'
REQUIRED = {
    'package.json', 'package-lock.json', 'server/index.ts', 'server/.product-help.json',
    'dist/index.html', 'protected-tools/manifest.json', 'project-evolution/generated.json',
    'node_modules/tsx/dist/cli.mjs',
}
FORBIDDEN = {
    '.env', '.git', '.local-docs', 'data', 'AGENTS.md', 'AGENTS.local.md',
    'DEPLOY.md', 'CONTINUOUS-REQUIREMENTS.md',
}
CHUNK = 1024 ** 2
BLOCK = 4096


def digest(stream):
    checksum = hashlib.sha256()
    for block in iter(lambda: stream.read(CHUNK), b''):
        checksum.update(block)
    return checksum.hexdigest()


def release_path(name):
    parts = name.split('/')
    if (parts[0] != ROOT or any(part in ('', '.', '..') for part in parts)
            or '\\' in name or any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise ValueError('ARCHIVE_PATH_INVALID')
    if len(parts) > 1 and parts[1] in FORBIDDEN:
        raise ValueError('ARCHIVE_SERVER_FILES_FORBIDDEN')
    return '/'.join(parts[1:])


def read_manifest(stream):
    raw = stream.read(2 * CHUNK + 1)
    if len(raw) > 2 * CHUNK:
        raise ValueError('RELEASE_MANIFEST_SIZE')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('RELEASE_MANIFEST_FORMAT')
    return value


def validate_links(members, links):
    for name in members:
        parts = name.split('/')
        if any(members.get('/'.join(parts[:length])) in ('file', 'link') for length in range(1, len(parts))):
            raise ValueError('ARCHIVE_PATH_THROUGH_NON_DIRECTORY')
    for target in links.values():
        # npm .bin links should target a member packaged in the same dependency tree.
        if members.get(target) not in ('file', 'directory'):
            raise ValueError('ARCHIVE_LINK_TARGET_MISSING')


def verify_archive(file, expected_sha, expected_commit, expected_version):
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha) or not re.fullmatch(r'[a-f0-9]{40}', expected_commit):
        raise ValueError('RELEASE_IDENTITY_FORMAT')
    members, links, file_digests = {}, {}, {}
    expanded_bytes = estimated_block_bytes = 0
    manifest = None
    # The same open descriptor is used for the outer digest and the member scan.
    entry = file.lstat()
    if not stat.S_ISREG(entry.st_mode):
        raise ValueError('RELEASE_ARCHIVE_NOT_REGULAR')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_BINARY', 0)
    descriptor = os.open(file, flags)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('RELEASE_ARCHIVE_NOT_REGULAR')
        if (info.st_dev, info.st_ino) != (entry.st_dev, entry.st_ino):
            raise ValueError('RELEASE_ARCHIVE_CHANGED')
        if digest(stream) != expected_sha:
            raise ValueError('RELEASE_ARCHIVE_SHA_MISMATCH')
        stream.seek(0)
        with tarfile.open(fileobj=stream, mode='r|gz') as archive:
            for item in archive:
                name = release_path(item.name)
                if name in members:
                    raise ValueError('ARCHIVE_DUPLICATE_MEMBER')
                if (item.mode & 0o6000) or item.issparse():
                    raise ValueError('ARCHIVE_UNSUPPORTED_MEMBER')
                if item.isdir():
                    members[name] = 'directory'
                    estimated_block_bytes += BLOCK
                    continue
                if item.issym() and name.startswith('node_modules/'):
                    link = item.linkname
                    target = posixpath.normpath(posixpath.join(posixpath.dirname(name), link))
                    if (not link or link.startswith('/') or '\\' in link
                            or not target.startswith('node_modules/')):
                        raise ValueError('ARCHIVE_LINK_OUTSIDE_DEPENDENCIES')
                    members[name] = 'link'
                    links[name] = target
                    continue
                if not name or not item.isreg():
                    raise ValueError('ARCHIVE_UNSUPPORTED_MEMBER')
                members[name] = 'file'
                expanded_bytes += item.size
                estimated_block_bytes += (item.size + BLOCK - 1) // BLOCK * BLOCK
                if name == MANIFEST:
                    if item.size > 2 * CHUNK:
                        raise ValueError('RELEASE_MANIFEST_SIZE')
                    manifest = read_manifest(archive.extractfile(item))
                elif not name.startswith('node_modules/'):
                    file_digests[name] = digest(archive.extractfile(item))
        closing = os.fstat(stream.fileno())
        if (closing.st_size, closing.st_mtime_ns, closing.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
            raise ValueError('RELEASE_ARCHIVE_CHANGED')
    validate_links(members, links)
    if members.get('') != 'directory' or any(members.get(name) != 'file' for name in REQUIRED):
        raise ValueError('RELEASE_REQUIRED_FILES_MISSING')
    if (not manifest or manifest.get('commit') != expected_commit or manifest.get('version') != expected_version
            or manifest.get('platform') != 'linux' or manifest.get('arch') != 'x64'
            or manifest.get('dependencies') != 'complete-linux-node_modules'
            or not re.fullmatch(r'v\d+\.\d+\.\d+', str(manifest.get('node')))):
        raise ValueError('RELEASE_MANIFEST_IDENTITY_MISMATCH')
    if manifest.get('files') != file_digests:
        raise ValueError('RELEASE_SOURCE_HASH_MISMATCH')
    return {
        'sha256': expected_sha, 'commit': expected_commit, 'version': expected_version,
        'node': manifest.get('node'), 'platform': 'linux-x64',
        'archiveBytes': info.st_size, 'fileBytes': expanded_bytes, 'entries': len(members),
        'estimatedBlockBytes': estimated_block_bytes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    try:
        result = verify_archive(args.archive, args.sha256, args.commit, args.version)
    except (OSError, tarfile.TarError, ValueError) as error:
        code = str(error)
        print(json.dumps({'ok': False, 'error': code if re.fullmatch(r'[A-Z_]+', code) else 'ARCHIVE_READ_FAILED'}))
        return 1
    print(json.dumps({'ok': True, **result}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
