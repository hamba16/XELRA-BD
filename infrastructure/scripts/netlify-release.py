"""Budget check and static ZIP deployment. No builds and no secret output."""
import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
import zipfile

token, site = os.environ['NETLIFY_TOKEN'], os.environ['NETLIFY_SITE_ID']
if not all(c.isalnum() or c == '-' for c in site):
    raise SystemExit('Invalid site ID')

def api(path, body=None):
    request = urllib.request.Request('https://api.netlify.com/api/v1/' + path, data=body,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/zip' if body else 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)

def budget():
    month = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m')
    used = 0
    for page in range(1, 1001):
        rows = api(f'sites/{site}/deploys?per_page=100&page={page}')
        for row in rows:
            # Count failed/processing attempts too, not only ready deployments.
            if row.get('context') == 'production' and row['created_at'].startswith(month):
                used += 1
        if len(rows) < 100 or all(row['created_at'][:7] < month for row in rows):
            break
    else:
        raise SystemExit('Cannot establish deployment budget')
    if used >= 6:
        raise SystemExit('Six production deployment attempts already made this UTC month')
    print(f'Production deployment budget: {used}/6 used')

budget()
if sys.argv[1:] == ['check']:
    raise SystemExit(0)
if sys.argv[1:] != ['deploy']:
    raise SystemExit('Use check or deploy')
directory = Path('out')
assert (directory / '_headers').is_file() and (directory / '404.html').is_file()
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise SystemExit('Symlinks prohibited')
        if path.is_file():
            z.write(path, path.relative_to(directory).as_posix())
deployment = api(f'sites/{site}/deploys', buffer.getvalue())
for _ in range(120):
    result = api(f"deploys/{deployment['id']}")
    if result['state'] == 'ready':
        print(json.dumps({'deploy_id': result['id'], 'state': result['state']}))
        break
    if result['state'] in ('error', 'failed'):
        raise SystemExit('Production deployment failed')
    time.sleep(5)
else:
    raise SystemExit('Deployment readiness timed out')
