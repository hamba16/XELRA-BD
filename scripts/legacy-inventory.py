"""Read-only document inventory and reviewed-mapping plan; never uploads or files documents."""
from pathlib import Path
import argparse
import hashlib
import json

EXTENSIONS = {'.pdf', '.docx', '.xlsx', '.pptx', '.dwg', '.dxf', '.jpg', '.jpeg', '.png', '.webp', '.csv', '.zip'}
DIVISIONS = {'ENG', 'AMG', 'COR'}

def inventory(root, mappings=None):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Choose a directory containing documents.')
    mappings = mappings or {}
    rows = []
    for path in root.rglob('*'):
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            continue
        if any(parent.is_symlink() for parent in path.parents if parent != root):
            continue
        before = path.stat()
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError(f'File changed while hashing: {path.relative_to(root)}')
        relative = path.relative_to(root).as_posix()
        mapping = mappings.get(relative)
        approved = bool(mapping and mapping.get('reviewed') is True)
        if approved:
            import re
            if mapping.get('division') not in DIVISIONS or not re.fullmatch(r'P\d{3}|CORP', mapping.get('project', '')) or mapping.get('type') not in {'RPT','DWG','LTR','CTR','VAR','QTN','PO','INV','MIN','POL','FRM','CRT','PHO','OTH'}:
                raise ValueError(f'Invalid reviewed mapping: {relative}')
        supported = path.suffix.lower() in EXTENSIONS
        rows.append({'original_path': relative, 'original_name': path.name, 'size': before.st_size, 'modified_ns': before.st_mtime_ns,
                     'sha256': digest.hexdigest(), 'supported_type': supported, 'mapping': mapping if approved else None,
                     'review_required': not (approved and supported), 'duplicate_of': None})
    rows.sort(key=lambda row: (row['modified_ns'], row['original_path']))
    seen = {}
    for row in rows:
        if row['sha256'] in seen:
            row['duplicate_of'] = seen[row['sha256']]
        else:
            seen[row['sha256']] = row['original_path']
    return {'mode': 'dry-run', 'count': len(rows), 'unique_content': len(seen), 'files': rows,
            'next': 'Review unmapped files. Apply numbering only through the document API after review.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--mappings', type=Path, help='JSON keyed by relative path with reviewed, division, project and type fields')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.directory.resolve(strict=True)
    output = args.output.resolve()
    if output.is_relative_to(root):
        parser.error('Write the inventory outside the source directory.')
    if output.exists():
        parser.error('Choose a new output file; existing inventories are not overwritten.')
    plan = inventory(root, json.loads(args.mappings.read_text(encoding='utf-8')) if args.mappings else None)
    output.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Inventoried {plan["count"]} files; {plan["unique_content"]} unique contents. No source files were changed.')
