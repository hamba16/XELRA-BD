"""Reproducible provenance inventory; original inputs are never edited."""
from pathlib import Path
import hashlib, json, zipfile
root = Path(__file__).resolve().parents[2]
source = root / 'files'
rows = [{ 'path': p.relative_to(root).as_posix(), 'bytes': p.stat().st_size,
          'sha256': hashlib.sha256(p.read_bytes()).hexdigest() }
        for p in sorted(source.rglob('*')) if p.is_file()]
(root / 'docs/source/inventory.json').write_text(json.dumps(rows, indent=2) + '\n', encoding='utf-8')
with zipfile.ZipFile(source / 'xelra-lab.zip') as archive:
    for item in archive.infolist():
        if item.is_dir(): continue
        p = source / 'xelra-lab' / item.filename
        assert p.resolve().is_relative_to(source.resolve())
        assert p.read_bytes() == archive.read(item), item.filename
print(f'{len(rows)} original files inventoried; ZIP and extracted lab are byte-identical.')
