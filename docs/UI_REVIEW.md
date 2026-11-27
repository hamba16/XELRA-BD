# UI review · enhanced workspace

Evidence: source review, running Chromium walkthrough, desktop and 375/320 px viewports, light/dark themes, keyboard command search and axe serious/critical checks. Audience: Dreniak staff making requests/decisions, including mobile users on unreliable networks.

Verdict: **Provisional for pre-production use.** Zero open serious/critical axe findings in the two checked contexts after fixes. This is not full WCAG certification or live sign-in acceptance.

Visual direction: the desktop rail uses a restrained blueprint grid and drafting marks, with a muted revision outline revealed on hover or keyboard focus. A softly faded, enlarged Ag Rosa rendering spans the dashboard behind its slate-and-paper work surfaces. Non-navigation actions use layered glass surfaces; segmented controls and dense inline record actions keep their compact forms.

| Fixed finding | Severity | Change | Verification |
| --- | --- | --- | --- |
| Brand button label/content mismatch | S1 | Natural accessible name | Desktop axe passes |
| Scrollable table inaccessible to keyboard | S1 | Focusable named region | Mobile axe passes |
| Dark combined-lens contrast | S1 | Text token replaces paper token | Dark scan passes |
| Disabled and constrained button labels | S2 | Preserve disabled-label contrast and allow labels to wrap without clipping | Light/dark contrast and 200% text-size checks at 320 px |
| Mobile viewport height | S3 | Dynamic viewport and bottom clearance | No page overflow at 375/320 px |

Browser flows cover approval, request submission, draft restoration, division filtering, command navigation, offline save and reconnect sync. Empty states do not invent production figures. Errors preserve drafts. The synthetic walkthrough is excluded from production.

Finance now has a scope-labelled overview with real, permission-filtered record/payroll figures, workflow bars, and six-month charts. Chart style and theme are profile-scoped browser preferences. Settings is available to every profile. Live profile photos use a private, owner-only Storage bucket; synthetic preview uploads remain disabled.

Not verified: physical Safari storage eviction, real Entra/OTP/MFA sessions, screen-reader speech, OS forced colours, browser zoom at 200% or 400%, live private-bucket upload/read/delete, measured mobile network Core Web Vitals or every role/data volume. Photo upload requires the forward migration and configured Supabase Storage. Secondary metadata sizing and imported inline styles remain refinements.

Screenshots: `.validation/workspace-desktop.png` and `.validation/workspace-mobile-dark.png`.
