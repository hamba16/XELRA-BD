# XELRA simulation kit

Everything here ran on real Postgres (pgserver) and plain Python. No cloud account is needed.

    pip install pgserver "psycopg[binary]" pyyaml
    python tests/db_invariants.py     # database invariants; RESULT.certified must be true
    python monte_carlo.py             # capacity, hosting credits, offline sync, approvals, colour checks

`iac/` holds the validated Netlify config, CSP hash generator and four GitHub workflows.
Change an assumption at the top of `monte_carlo.py`, rerun, and read the new numbers.
