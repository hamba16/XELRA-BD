# UI review · enhanced workspace

Evidence: source review, running Chromium walkthrough, desktop and 375/320 px viewports, light/dark themes, keyboard command search and axe serious/critical checks. Audience: Dreniak staff making requests/decisions, including mobile users on unreliable networks.

Verdict: **Provisional for pre-production use.** Zero open serious/critical axe findings in the two checked contexts after fixes. This is not full WCAG certification or live sign-in acceptance.

| Fixed finding | Severity | Change | Verification |
| --- | --- | --- | --- |
| Brand button label/content mismatch | S1 | Natural accessible name | Desktop axe passes |
| Scrollable table inaccessible to keyboard | S1 | Focusable named region | Mobile axe passes |
| Dark combined-lens contrast | S1 | Text token replaces paper token | Dark scan passes |
| Mobile viewport height | S3 | Dynamic viewport and bottom clearance | No page overflow at 375/320 px |

Browser flows cover approval, request submission, draft restoration, division filtering, command navigation, offline save and reconnect sync. Empty states do not invent production figures. Errors preserve drafts. The synthetic walkthrough is excluded from production.

Not verified: physical Safari storage eviction, real Entra/OTP/MFA sessions, screen-reader speech, OS forced colours, 200/400% zoom, photos, measured mobile network Core Web Vitals or every role/data volume. Secondary metadata sizing and imported inline styles remain refinements.

Screenshots: `.validation/workspace-desktop.png` and `.validation/workspace-mobile-dark.png`.
