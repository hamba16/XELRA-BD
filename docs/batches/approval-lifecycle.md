# Approval lifecycle batch

Scope: blueprint sections 6.1, 9.6 and 9.9; enhancement of the existing approval engine.

1. Owner-only pending-request withdrawal, serialised against decisions, with audit and transactional notification handling.
2. Scoped request detail with immutable decision reasons, approval steps and a projected audit timeline.
3. Stuck-request detection: scoped inbox view for business users and aggregate-only technical health for IT.
4. Server-side history pagination/filtering, per-profile saved filters, keyboard navigation and loading/error/empty states.

Acceptance: migration/access tests, both cancellation/approval orderings, no cross-division or IT business-data leakage, no repeat withdrawal, valid audit chain, notification lease invalidation, browser withdrawal/detail/filter flows and accessibility checks. Existing production migrations and original Files inputs stay unchanged.

Status: implementing. Hosted migration/deployment is outside this local batch; no provider configuration or secrets are changed.
