#!/usr/bin/env python3
"""Check Orbit readiness from a runner outside the production host."""
import argparse
import json
import os
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(url, commit, version):
    client = build_opener(NoRedirect())
    with client.open(Request(url, headers={'Cache-Control': 'no-store'}), timeout=8) as response:
        result = json.loads(response.read(4097))
        if response.status != 200 or result.get('status') != 'ready':
            raise ValueError('Orbit is not ready')
        if commit and (result.get('commit'), result.get('version')) != (commit, version):
            raise ValueError('unexpected deployed release')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit')
    parser.add_argument('--version')
    args = parser.parse_args()
    target = os.environ.get('ORBIT_HEALTH_URL', '')
    url = urlsplit(target)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path != '/api/ready':
        parser.error('ORBIT_HEALTH_URL must be a public HTTPS /api/ready endpoint')
    for attempt in range(1, 4):
        try:
            check(target, args.commit, args.version)
            print('Orbit readiness confirmed')
            return 0
        except (TimeoutError, URLError, ValueError, AttributeError) as error:
            print(f'Attempt {attempt}/3: {type(error).__name__}', flush=True)
            if attempt < 3:
                time.sleep(15)
    print('::error title=Orbit P0::Public readiness probe failed three times')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
