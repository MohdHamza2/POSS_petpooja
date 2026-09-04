# Cross-verification of Manus production-gap audit

Date: 2026-09-04
Audience: PetPooja engineering and operations owners

Scope: Manus audit saved as `2026-09-03-manus-production-gap-audit.md`, repository `main` at `c909dec`, and read-only local verification.

## Direct answer

The Manus conclusion remains correct: this is a development-integration product, not a production release candidate. Its assessment is partly stale because four commits after the audited `85a019e` now make workspace typecheck pass and add focused backend tests. However, production build still fails; API is offline; external webhook ingress remains unauthenticated; finance write operations use `report.read`; and settlement is not transactionally atomic or concurrency-safe.

## Primary evidence

- `npm run typecheck`: passed all workspaces.
- `npm run build`: failed in integration-hub, kitchen, menu, and purchase because cross-package source imports violate TypeScript `rootDir`; `apps/admin-web` build remains an echo command.
- `npm test --workspaces --if-present`: exit 0, but admin/auth/integration-hub/kitchen/marketing/menu/notifications/purchase/printing/settings/tax have no effective test suite or explicit echo placeholder.
- `npm run lint`: 0 errors, 109 warnings.
- `npm run contracts:validate`: valid OpenAPI syntax with 8 warnings only.
- `npm run status`: PostgreSQL, Redis, POS UI online; API gateway offline.

## Material confirmations

- Webhook route accepts no signature, trusts request outlet or first outlet, deduplicates by a race-prone order lookup, and maps unknown items to first menu item.
- Many source files post operational/customer/order diagnostics to `127.0.0.1:7323`; this is committed production-path code.
- Finance mutations use `report.read`.
- Wastage updates ingredient and log records in a loop, outside one transaction, with no non-negative/concurrency check.
- Settlement command sequences payment, invoice, drawer, stock, loyalty and order writes outside one database transaction; invoice number generation uses count-plus-one.

## Material changes after Manus audit

- Workspace typecheck now passes.
- Root test command now exits 0; this proves selected unit tests only, not complete coverage.
- Earlier duplicate settlement handler was replaced by a single settlement command.
- DB and Redis are now online locally; API remains offline.

## Limitation

No destructive E2E flow was run against shared local database. Full interaction, provider, printer, and concurrency behavior remains unproven.
