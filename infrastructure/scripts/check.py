"""No credentials or network. Validate configuration and source contracts."""
from pathlib import Path
import json, re, tomllib

root = Path(__file__).resolve().parents[2]
config = tomllib.loads((root / 'supabase/config.toml').read_text())
assert config['api']['schemas'] == ['api']
assert config['api']['max_rows'] == 50
assert not config['auth']['enable_signup']
assert not config['auth']['enable_anonymous_sign_ins']
assert config['auth']['jwt_expiry'] <= 900
assert config['auth']['mfa']['totp']['verify_enabled']
assert not config['db']['seed']['enabled']
tomllib.loads((root / 'netlify.toml').read_text())
json.loads((root / 'package-lock.json').read_text())
migrations = sorted((root / 'supabase/migrations').glob('*.sql'))
assert len(migrations) >= 2
for p in migrations:
    assert re.fullmatch(r'\d{14}_[a-z_]+\.sql', p.name)
    assert p.read_text().strip()
for p in (root / 'infrastructure/terraform').glob('*.tf'):
    assert 'local-exec' not in p.read_text(), 'Provisioners are prohibited'
print('Foundation configuration checks passed')
