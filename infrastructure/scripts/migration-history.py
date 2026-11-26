"""Validate forward-only migrations against a trusted Git baseline; no database access."""
import argparse
import datetime
from pathlib import Path
import re
import subprocess


def check(root, base):
    root = Path(root)
    if not re.fullmatch(r'[0-9a-f]{40}', base):
        raise ValueError('Baseline must be a full Git commit SHA')

    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)

    previous = {}
    if base != '0' * 40:
        git('cat-file', '-e', base + '^{commit}')  # Missing history must fail, not become an empty baseline.
        for entry in git('ls-tree', '-rz', base, '--', 'supabase/migrations/').split(b'\0'):
            if not entry:
                continue
            meta, name = entry.split(b'\t', 1)
            mode, kind, oid = meta.split()
            if name.endswith(b'.sql'):
                if mode != b'100644' or kind != b'blob':
                    raise ValueError('Baseline contains a non-regular migration')
                previous[name.decode()] = git('cat-file', 'blob', oid.decode()).replace(b'\r\n', b'\n')

    current = {}
    versions = set()
    directory = root / 'supabase/migrations'
    if directory.is_symlink():
        raise ValueError('Migration directory cannot be a symlink')
    for file in sorted(directory.glob('*.sql')):
        match = re.fullmatch(r'(\d{14})_[a-z][a-z0-9_]*\.sql', file.name)
        if not match or file.is_symlink() or not file.is_file():
            raise ValueError('Invalid migration filename or file type: ' + file.name)
        version = match[1]
        datetime.datetime.strptime(version, '%Y%m%d%H%M%S')
        if version in versions:
            raise ValueError('Duplicate migration timestamp: ' + version)
        versions.add(version)
        data = file.read_bytes().replace(b'\r\n', b'\n')
        if not data.strip():
            raise ValueError('Empty migration: ' + file.name)
        current[file.relative_to(root).as_posix()] = data
    if not current:
        raise ValueError('No migrations found')
    for name, data in previous.items():
        if current.get(name) != data:
            raise ValueError('Existing migration edited, deleted or renamed: ' + name)
    latest = max((Path(name).name[:14] for name in previous), default='')
    added = current.keys() - previous.keys()
    if any(Path(name).name[:14] <= latest for name in added):
        raise ValueError('New migrations must sort after the baseline history')
    return {'existing': len(previous), 'added': len(added)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    args = parser.parse_args()
    print(check(Path.cwd(), args.base))
