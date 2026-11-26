import json
import os
import re
import subprocess

buckets = os.environ['R2_BUCKETS'].split(',')
assert len(buckets) >= 4 and all(re.fullmatch(r'[a-z0-9][a-z0-9-]{2,62}', b) for b in buckets)
total = 0
for bucket in buckets:
    result = subprocess.run(['rclone', 'size', '--json', 'r2:' + bucket], check=True, capture_output=True, text=True)
    total += json.loads(result.stdout)['bytes']
subprocess.run(['node', 'infrastructure/scripts/ops.mjs', 'meter', 'r2_bytes', str(total), os.environ['R2_CAPACITY_BYTES']], check=True)
