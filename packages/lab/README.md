# xelra-lab

Executable evidence for the XELRA Blueprint. Needs Node 20+ and Python 3. No database server or accounts.

    npm install
    npm test            # 61 database tests + unit tests + offline experiment + bank matcher
    npm run typecheck
    npm run bench       # RLS policy styles on 200,000 rows
    npm run sim         # capacity simulations
    npm run palette     # brand tints and WCAG contrast
    npm run sweep       # bank matcher threshold sweep

See section 12 of the blueprint for twenty experiments to try.
