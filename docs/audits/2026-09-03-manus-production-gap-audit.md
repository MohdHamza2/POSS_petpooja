PetPooja POS Platform: Verified State, Logic-Flow, and Production-Gap Audit

Author: Manus AI
Audit date: 3 September 2026
Scope: Attached Windows project, Git history, GitHub-visible repository, build/test commands, static connectivity graph, route/UI/test inventories, and targeted browser runtime checks.


Final verdict: The project is a substantial, database-oriented POS implementation with broad UI and API coverage, but it is not production-ready and should be treated as a no-go for live financial or restaurant operations. The current attached-computer state fails type checking; the GitHub-visible state fails the workspace build and test suite; the local API and data services are unavailable; several critical workflows lack atomicity, concurrency-safe idempotency, secure external verification, and strict permissions; and the project’s status documents materially overstate readiness.

1. Audit method and confidence

This review used deterministic repository inspection and executable checks rather than accepting milestone documents at face value. A clean clone of MohdHamza2/POSS_petpooja was inspected at GitHub-visible commit 169edfc, while the attached computer’s Git metadata showed local main at 85a019e, two unpublished commits ahead. Selected high-risk files from the true local state were compared directly with the remote state. The audit ran dependency installation, type checking, linting, contract validation, workspace tests, workspace builds, status reporting, Playwright discovery, a targeted E2E scenario, dependency auditing, static route/test mapping, UI/API mapping, and a browser check of the running POS surface.

The generated connectivity graph is a deterministic Graphify-equivalent structural import graph, not a full runtime call graph. It is useful for ownership and coupling analysis, but production behavior is determined by the executable checks and direct source review.

Evidence class
What was verified
Confidence
Git and repository
Branch state, recent commits, changed-file breadth, unpublished local commits
High
Build and type safety
Locked installation, typecheck, lint, OpenAPI validation, workspace build
High
Automated tests
Workspace test execution, API rerun with ephemeral test secret, E2E discovery and targeted E2E execution
High
Static connectivity
168 frontend API calls, 168 route aliases, module imports, route-to-test references
Medium-high
Runtime UI
POS shell, floor empty state, Orders error state, API unavailability
Medium-high
External providers and hardware
Source-level adapter and transport availability
High
Every interactive control
Static inventory plus targeted runtime review; full behavioral traversal blocked by API/DB outage
Medium




2. Current project state

The repository has meaningful breadth: 26 workspaces, hundreds of TypeScript files, 18 user-facing Next.js page files, 17 API route modules, domain services, Prisma persistence, migrations, contracts, and 35 discoverable Playwright scenarios. The live POS pages use a real authenticated HTTP helper rather than the legacy InMemoryMockApiClient; that mock belongs to an older screen/test path. The core issue is therefore not “there is no backend.” The issue is that real components exist but do not yet form a reliable, secure, atomic, reproducibly deployable production system.

Area
Verified status
Release assessment
Repository history
Attached main is two local commits ahead of GitHub main
Amber: true release source is not centralized
Dependency install
npm ci succeeded
Green with risk: nine moderate advisories remain
Type checking
Failed in local/current order route because diagnostic code reads a missing property
Red
Workspace build
Failed in integration-hub, kitchen, menu, and purchase; admin build is an echo script
Red
Lint
Completed with 113 warnings
Amber-red: weak quality gate
OpenAPI contracts
Valid with eight metadata warnings
Green for syntax only
Unit/integration tests
Root suite failed; multiple workspaces have placeholder or undiscoverable tests
Red
E2E tests
35 scenarios are discoverable; targeted webhook run failed because API was unavailable
Red
Database and Redis
Status command reported both offline
Red
API
Offline/unreachable during runtime review
Red
POS UI
Rendered, but showed blank outlet identity and an Orders HTTP 503
Amber-red
Security baseline
Missing rate limiting, refresh rotation, secure webhook verification, consistent mutation permissions, and correlation propagation
Red
Financial atomicity
Settlement, invoice, cash drawer, loyalty, inventory, and outbox effects are not one transaction
Red
External integrations
Marketing delivery, payment gateway capture, aggregator verification, and printer transport are incomplete
Red
Documentation truth
Status and UI audit claims conflict with executable evidence and individual decision files
Red
Production readiness
Core invariants are not proven
NO-GO




The built-in status command reported PostgreSQL, Redis, API, and POS UI as offline while simultaneously reporting “9/10 milestones passed,” “no blockers,” and “zero critical errors.” Its implementation combines shallow port checks with static checkpoint and agent-registry metadata; it does not cross-check builds, tests, migrations, security configuration, or transactional invariants. It is therefore an operational dashboard, not a release-readiness gate.

3. Recent changes and lessons

The latest GitHub-visible commit, 169edfc, changed 49 files with 1,990 insertions and 530 deletions across order lifecycle, settlement, tables, auth, CRM, finance, integration, inventory, kitchen, menu, reporting, POS billing, waiter flows, migrations, and shared types. The broader five-commit window changed 114 files with 9,257 insertions and 1,621 deletions. This work materially increased real connectivity, but the verification system did not scale with the integration breadth.

The two local-only commits add business-day logic, channel-state behavior, inventory wastage, finance and aggregator changes, and extensive diagnostic calls. The current local typecheck failure is caused by one of those diagnostic calls. The engineering lesson is direct: temporary instrumentation must be isolated behind typed observability interfaces and must never be committed as fire-and-forget HTTP calls inside business handlers.

A second lesson is that “shared committed facts” require one database transaction or durable saga, not merely sequential calls to multiple modules. The settlement flow presently spans status transitions, payment records, cash-drawer updates, invoices, table state, BOM depletion, loyalty, outbox events, and WebSocket notifications without one atomic boundary. That is connectivity in source code, but not a reliable business transaction.

4. Real logic flows and missing connectivity

4.1 Authentication and outlet scope

The real flow is login/PIN login → Prisma credential verification → session row → JWT → localStorage → authedFetch → requireAuth → JWT-derived user/outlet → route. Outlet scope is normally derived from the signed token, which is the right foundation.

The missing production controls are significant. Login and PIN endpoints have no rate limiting or lockout. Refresh tokens are not rotated. Logout is unauthenticated and accepts an arbitrary sessionId, so ownership is not verified. The browser stores bearer and refresh tokens in localStorage, increasing XSS impact. API base configuration is fragmented: getApiBase() reads NEXT_PUBLIC_API_URL, exported API_BASE is hardcoded to port 4001, and public ordering reads NEXT_PUBLIC_API_BASE. The client sends X-Outlet-Id, but the repository rule says the gateway must derive scope from JWT claims. No global correlation-ID middleware was found.

Required connectivity: one API configuration function; an authenticated, ownership-checked logout; refresh rotation and reuse detection; rate limiting and PIN lockout; secure token strategy; correlation IDs; structured security audit events; and tests proving cross-outlet denial.

4.2 Dine-in, pickup, delivery, and order numbering

The principal staff flow is POS/waiter UI → authedFetch → POST /orders → price lookup → PrismaOrderRepository → order and line writes → KOT orchestration → table state. The route and service layers are real, and frontend calls structurally match backend routes.

However, findByIdempotencyKey() still returns null, and the Order model does not persist an idempotency key. The fallback order number is calculated as count + 1, which races under concurrent terminals. The staff and QR routes generate a fresh idempotency key when the client omits one; a retry without a stable client key therefore creates a new order. Database uniqueness on outlet/order number prevents some duplicates but turns concurrency into errors rather than safe retries.

Required connectivity: persist a unique (outlet_id, idempotency_key); require stable client-generated keys for every command; use a database sequence/counter row with locking for bill and KOT numbers; treat uniqueness collisions as retryable; and prove two-terminal concurrency in integration tests.

4.3 Settlement, payment, invoice, table, inventory, loyalty, and outbox

The settlement command intentionally connects many domains, but it does so sequentially. It reads the order, advances statuses, writes one or more payments, updates a cash-drawer session, writes invoices, updates order totals and settledAt, cascades KOT state, releases tables, deducts BOM stock, increments loyalty, creates outbox data, and broadcasts events.

The sequence has no encompassing transaction or row lock. Concurrent settlement calls can both observe an unsettled order. The payment schema has no unique idempotency or transaction constraint. Invoice numbering uses count + 1. Existing cash payments can be added to the drawer again on a resumed/retried path. Some loyalty and outbox errors are swallowed. The code can set order subtotal equal to invoice sum, conflating pre-tax subtotal and grand total. If an intermediate action fails, the system can retain payment without invoice, invoice without inventory deduction, closed order with occupied table, or completed order without durable outbox delivery.

Required connectivity: a serializable transaction or explicit locked aggregate; unique payment-command keys; deterministic invoice numbering; atomic payment/invoice/order/cash-drawer writes; transactional outbox written in the same transaction; asynchronous inventory/loyalty consumers with idempotent event handlers if those domains are deliberately decoupled; and invariant checks that reconcile all totals.

4.4 Tables, merge, transfer, and kitchen lifecycle

The project has real table, waiter, KOT, transfer, merge, unmerge, serve, and status endpoints. The UI has matching calls. The remaining concern is that route handlers and orchestration code directly touch multiple domains while documentation claims domain isolation. Several mutating routes lack declarative permission middleware and depend on inline checks or authentication alone. The recent changes also include broad automatic status advancement during settlement, which can bypass operational steps unless explicitly approved.

Required connectivity: define one authoritative order/table/KOT state machine; move each cross-domain command into a tested application service; enforce expected version/status preconditions; attach immutable audit writes to the same transaction; and reject illegal transitions rather than logging and continuing.

4.5 Aggregator ingestion and channel management

The integration UI is structurally connected. All five initially suspicious frontend URLs match one of the backend’s array-declared route aliases. Credential storage is not real: encryption helpers are imported but unused, and the connect flow stores a channel label/reference rather than encrypted provider credentials.

Inbound webhook handling is a critical blocker. The active route does not verify an HMAC signature, despite a separate aggregator service existing. A stub contract still accepts only the literal header value valid-signature and is not connected to the active route. The handler accepts a request-supplied outlet or falls back to the first outlet in the database. It deduplicates by reading an order number before creation, which is race-prone, while ignoring the schema’s dedicated inbound-event uniqueness model. Unmatched external items fall back to the first menu item, which can corrupt sales, tax, recipe, and stock facts. Order creation, status history, KOT generation, audit, and broadcast are not one transaction.

Required connectivity: provider-account-derived outlet resolution; raw-body HMAC verification with timestamp/replay window; persistent inbound-event receipt before processing; unique provider/account/event key; explicit dead-letter handling; external-item mapping with quarantine on unknown items; transactional order creation plus outbox; provider acknowledgement semantics; and sandbox certification tests.

4.6 Inventory, recipes, wastage, and procurement

Inventory, recipe, vendor, purchase-order, and GRN surfaces exist and have real Prisma writes. The true local inventory router registers POST /wastage twice under different permissions. The earlier handler updates each ingredient and writes its wastage record in a loop without one transaction. Failure midway creates partial stock changes. It also performs unsafe Prisma casts and does not visibly enforce non-negative stock or a concurrency version.

Procurement has source-level services and API routes, but its package test script remains a placeholder, and the workspace build fails through cross-package source imports. Approval thresholds and variance policies remain placeholder business decisions in project documents.

Required connectivity: one wastage command and one permission; transactionally create wastage header/lines, movements, balances, audit, and notifications; optimistic versioning; explicit negative-stock policy; DB-backed PO numbering; real approval policy data; three-way match and vendor-payable handoff; and integration tests against PostgreSQL.

4.7 Finance and cash drawer

Finance routes and UI are real. Z-report business-day handling improved in local changes. Yet petty cash, drawer open, reconciliation, and close-shift are guarded by report.read, a read permission. Petty-cash creation and drawer-balance mutation are not one transaction. Shift close can race. The project contains no payment-provider adapter, capture webhook, settlement-file reconciliation, or transaction idempotency.

Required connectivity: finance-specific write permissions; maker-checker or manager override for sensitive operations; row locking on one open drawer session; atomic petty cash and balance mutation; immutable journal entries; signed Z-report sealing; payment provider abstraction and reconciliation; refund idempotency; and totals that can be independently recomputed from the ledger.

4.8 CRM, loyalty, and marketing

CRM persistence, customer resolution, and loyalty tables exist. Customer creation from aggregator events is real but occurs before the order transaction and can be orphaned. Loyalty updates during settlement swallow errors and assign a hardcoded SILVER tier, conflicting with the rule against hardcoded business policy. Individual decision documents also state that loyalty and marketing details were pending discovery while later status documents describe them as complete.

Marketing only queues recipients as PENDING; no SMS, WhatsApp, email, or push provider is configured. The UI honestly exposes this in some places, but production readiness documents should classify it as unavailable, not fully connected.

Required connectivity: configurable loyalty policy and tiering; idempotent earn/redeem ledger; transactional or outbox-driven customer updates; consent and suppression lists; gateway adapter; delivery receipts; retry/DLQ; template approval; and legal review for erasure versus invoice retention.

4.9 Reporting and statutory outputs

Reporting endpoints and dashboards exist. The local business-day helper is a positive step. The remaining gap is semantic governance: 16 individual decision files still carry Status: OPEN, 187 decision checkboxes remain unchecked, and KPI/formula decisions conflict with a central decision log claiming zero open items. Until formulas, time zones, refund attribution, tax treatment, and versioning are signed and tested, dashboards are computational output, not trusted financial reporting.

Required connectivity: signed formula catalogue; formula/version metadata on summaries; immutable source-to-report lineage; reconciliation against invoices/payments/tax ledger; timezone/business-day fixtures; and accountant-approved golden datasets.

4.10 Printing, hardware, offline mode, and desktop delivery

The printing service produces a structured PrintDocument; its own type definition explicitly says it does not generate PDF or ESC/POS bytes and that the lower-level renderer is out of scope. Several UI actions call window.print(). That is a browser print preview, not a resilient thermal-printer/KOT transport with spool, retry, status, and duplicate suppression.

The delivered product is a Next.js/Express application launched by Windows batch/PowerShell scripts. It is not yet a packaged desktop product with installer, service management, code signing, auto-update, rollback, local database lifecycle, or offline synchronization. LocalStorage queues exist in limited paths, but there is no verified offline data model and conflict resolution across all critical commands.

Required connectivity: supported printer adapters; print-job persistence and idempotency; device health and fallback routing; desktop/service packaging; signed installer; migration-aware updater and rollback; encrypted local data; durable offline command queue; synchronization conflict rules; and pilot hardware certification.

5. Feature, control, module, and test audit

Static analysis found 347 native <button> tags and 414 onClick handlers across the POS code, significantly more than the project’s static audit claim of 148 controls. This does not mean 414 unique product controls; it proves that the old count is no longer an authoritative inventory. A generated UI/API map parsed 168 literal frontend calls and matched all of them to backend route declarations or aliases. This is strong evidence of broad structural wiring, but it does not prove authorization, transactionality, data correctness, or runtime availability.

Domain
What is genuinely present
Key unverified or missing production behavior
Auth/RBAC
Login, PIN login, JWT, sessions, outlet grants, route guards
Rate limit, lockout, refresh rotation, secure logout, XSS-resilient token handling, cross-outlet suite
POS/orders
Dine-in, pickup, delivery, hold, add items, charges, settlement routes
Real idempotency, concurrent numbering, atomic settlement, correct totals
Tables/waiter
Floor, status, transfer, merge/unmerge, waiter operations
Version checks, one state machine, atomic order/table/KOT changes
Kitchen
Stations, KOT listing, status updates, recall, WebSocket/polling UI
Real printer dispatch, strict transition proof, complete service tests
Menu/86
Categories, items, bulk upload, modifiers, availability
Buildable package, channel mapping truth, version conflict UX
Inventory
Ingredients, recipes, stock adjustments, wastage, availability
Duplicate wastage route, transactional movements, negative-stock policy
Purchase
PO/GRN routes and repository
Build, tests, numbering, approval policy, finance handoff
Finance
Z-report, cash drawer, petty cash, refunds, invoices
Write RBAC, atomic ledger, gateway capture, reconciliation, sealed reporting
CRM/loyalty
Customer CRUD, lookup, redeem/earn data paths
Consent, idempotent ledger, configurable policy, legal retention implementation
Marketing
Campaign and recipient queue
Actual delivery provider, callbacks, retry/DLQ, consent enforcement
Aggregators
Channel UI, inbound order route, status actions
Real secrets, signature, event store, item mapping, certification
Reporting
Sales, payment, channel, tax, item, table metrics
Signed formulas, lineage, reconciliation, formula versions
Notifications
API and bell component
Delivery durability, preferences, external push channel, dedicated tests
Settings
Outlet and channel status paths
Mutation permission, audit, no-default-open fail-safe policy
Printing
Structured render model and browser print
ESC/POS/PDF transport, spooler, hardware status, retry and dedupe
Admin web
Package manifest and scripts
A real standalone application; current build/test scripts are placeholders
Agents/operations
Registry, task board, Markdown role definitions, status display
Executable orchestration, leases, retries, audit trail, real health derivation




The generated route-to-test map found references for 92 of 168 route aliases, or 55%. This is only reference coverage; 13 test files contain permissive status ranges or conditional assertions. The webhook test, for example, accepts 200, 201, 202, 400, or 404 and never queries a persistent event/order count. It therefore does not prove deduplication.

The root test command failed for multiple independent reasons. API tests die without JWT_SECRET; with an ephemeral secret, three of four tests passed and login returned 500 because no database was available. POS TSX tests fail during parsing. Admin, printing, settings, and tax report no discovered tests. Seven service packages explicitly echo “no tests yet,” and the admin-web test script only echoes text. The E2E configuration does not boot its dependencies, so it is not self-contained.

6. Highest-priority gaps

Priority
Gap
Why it is a blocker
Required proof before closure
P0
Main branch does not typecheck or build
No reproducible artifact can be released
Clean clone passes install, typecheck, lint-as-error, build
P0
Settlement is not atomic/idempotent
Can corrupt money, invoices, drawer, stock, loyalty, and tables
Concurrent settlement integration test and invariant queries
P0
Order idempotency is nominal
Duplicate orders/KOTs are possible on retries
Persistent unique idempotency key and replay test
P0
Aggregator webhook is unauthenticated and mis-maps items/outlets
External requests can create incorrect business facts
HMAC, account-bound outlet, event-store dedupe, unknown-item quarantine
P0
Finance/store mutations use weak permissions
Ordinary readers may perform sensitive operations
Explicit permissions and negative RBAC tests
P0
Logout/session endpoints are unsafe
Session revocation is not ownership-bound
Authenticated own-session revocation tests
P0
API/DB/Redis runtime is unavailable
Core product functions return 503
Health/readiness probes plus successful smoke transaction
P0
Diagnostic HTTP calls are committed
They break typecheck and leak operational data paths
Remove or replace with typed structured telemetry
P1
Test harness is not self-contained
“Passing” claims cannot be reproduced
Ephemeral PostgreSQL/Redis, migrations, seed, services, teardown in CI
P1
Wastage route is duplicated and non-atomic
Partial stock and audit writes are possible
One transactional command with rollback test
P1
API configuration and outage UX are fragmented
Client can show blank outlet and error-plus-empty state
Central config and offline/outage component tests
P1
Decision and status documents contradict code
Teams cannot trust scope or release claims
Generated evidence-backed status and reconciled decision register
P1
External providers and printer transport are absent
Payments, marketing, aggregators, and hardware are not end-to-end
Sandbox/provider/hardware certification evidence
P1
Domain boundaries are inconsistent
Direct cross-table access increases regression and ownership risk
Application service boundaries or explicit modular-monolith policy
P2
Agent registry is documentation-only
“READY agents” do not perform autonomous checks
Runnable jobs with leases, logs, retries, and evidence outputs
P2
No signed desktop lifecycle
Installation/update/rollback risk remains
Signed installer, service supervision, updater, rollback drill
P2
Observability/SLOs are incomplete
Failures are discovered by operators rather than monitoring
Correlated logs, metrics, traces, SLOs, alerts, runbooks




7. Systematic debugging and TDD execution plan

Phase A: Establish one truthful baseline

Create a clean-clone CI job that provisions supported PostgreSQL and Redis versions, writes test-only secrets, runs migrations and deterministic seed data, starts API and POS processes, waits on dependency-aware readiness endpoints, and then runs format, lint, typecheck, build, unit, contract, integration, and E2E stages. Status generation must consume these artifacts instead of static checkpoint text.

The first acceptance criterion is simple: the same commit must produce the same result locally and in CI. Local-only commits must be published to a review branch before further work.

Phase B: Fix the test platform before business behavior

Use red-green-refactor to fix TypeScript errors, workspace rootDir/project-reference configuration, Vitest TSX transformation, workspace test discovery, and E2E dependency bootstrapping. Replace echo scripts with either real tests or an explicit “not implemented” failing gate. Remove broad status assertions and conditional branches that allow tests to pass without asserting state.

The acceptance criterion is that intentionally breaking one API handler, one database write, and one button action makes the relevant test fail.

Phase C: Lock financial and order invariants

Write failing PostgreSQL integration tests for two simultaneous order creations, a replayed order command, two simultaneous settlements, split payments, invoice uniqueness, cash-drawer totals, and partial failure after each settlement step. Then implement unique command keys, locked counters, atomic payment/invoice/order/cash writes, and a transactional outbox.

The acceptance criterion is a machine-checked invariant report: order total equals invoice totals; captured payments do not exceed the allowed amount; each settlement command has one durable result; cash drawer changes exactly once; and every committed mutation has an audit/outbox record.

Phase D: Secure external and public boundaries

Write failing tests for invalid webhook signature, stale timestamp, replayed event, missing provider account, wrong outlet, unmapped item, and provider retry. Add account-bound HMAC verification, raw payload storage, event-store uniqueness, item-map quarantine, and DLQ/replay tooling. Add rate limits and stable idempotency requirements to public QR ordering, login, PIN login, and refresh.

The acceptance criterion is that no unverified or replayed external message can create or alter an order.

Phase E: Correct inventory and finance commands

Write rollback tests for multi-line wastage, petty cash, drawer opening/closing, refunds, BOM deduction, and GRN. Consolidate duplicate routes; apply finance- and inventory-specific permissions; use locked rows or optimistic versions; and record audit entries in the same transaction.

The acceptance criterion is zero partial state after injected failure and deterministic balances after retry.

Phase F: Verify UI controls and failure states

Create an authoritative screen/control manifest generated from the current UI. For every control, map role, precondition, API command, success state, validation state, loading state, permission denial, conflict state, network failure, and retry behavior. Use browser automation and network inspection to verify the manifest. Replace the Orders “503 plus no orders” presentation with a single explicit unavailable state, and prevent an authenticated shell from rendering with a blank outlet.

The acceptance criterion is complete control-level coverage for the supported role matrix and no mutation triggered by unauthorized or double-click actions.

Phase G: Complete external delivery and desktop operations

Choose and implement payment, marketing, aggregator, and printer adapters behind typed ports. Add sandbox certification suites. Package the POS server/UI as a signed Windows deployment with supervised services, migrations, backups, update/rollback, and offline behavior appropriate to the approved architecture.

The acceptance criterion is a pilot run with real target hardware, provider sandboxes, outage drills, backup/restore, update/rollback, and signed operational acceptance.

8. Recommended skills for production hardening

Skill
When to use it
Concrete output
repository-production-audit
At each milestone and release candidate
Evidence-backed readiness report and no-go/go gate
systematic-debugging
For every failing build, test, or runtime discrepancy
Reproducible root cause and minimal verified fix
test-driven-development / tdd
For each P0/P1 behavior change
Red test, minimal implementation, refactor, regression proof
code-reviewer
Before merge of cross-domain changes
Prioritized defects, transaction and authorization review
api-designer
Before consolidating aliases and external contracts
Versioned OpenAPI, idempotency/error model, webhook contract
sql-optimization-patterns
For counters, reports, reconciliation, and hot queries
Lock/index/query design plus explain-plan evidence
observability-and-instrumentation
Replace hardcoded diagnostic calls
Structured logs, metrics, traces, correlation IDs
slo-implementation
Before pilot operations
Availability, latency, data-integrity SLOs and alert rules
ci-cd-and-automation
Make verification reproducible
Ephemeral dependency stack and mandatory release gates
web-design-reviewer
Control-by-control POS verification
Responsive, accessible, failure-aware UI fixes
chrome-devtools
Runtime API, WebSocket, storage, and performance checks
HAR/network evidence and client error diagnosis
persistent-computing
If the app must run as a durable local/cloud service
Supported runtime, supervision, backup, and deployment plan
agent-development
Only after verification jobs are real
Executable agents with leases, retries, evidence, and permissions
lesson-learned
After each debugging slice and incident
Reusable engineering rule and prevention control
content-gap-analysis
Reconcile requirements, decisions, implementation, tests, and runbooks
Traceability matrix and missing-artifact backlog




manus-api was not invoked because this audit did not require creating or modifying Manus tasks, projects, or integrations. Introducing task-management side effects would not improve source verification. The review instead prioritized local deterministic checks and only one targeted browser flow.

9. Release recommendation

The appropriate status is Development integration / pre-alpha hardening, not “Phase 4 production readiness.” The codebase has enough implemented surface to justify focused hardening rather than a rewrite. The safest sequence is to stop feature expansion, publish the two local commits to a review branch, make the repository build and test reproducibly, then fix order/payment/aggregator/inventory atomicity and authorization before continuing UI expansion.

Production go-live should remain blocked until all P0 items are closed with executable evidence, the target hardware/provider integrations pass certification, legal review resolves the customer-erasure/financial-retention conflict, and a clean release candidate survives concurrency, outage, restore, update, rollback, and multi-role authorization drills.

References

[1] JWT authentication and authorization middleware
[2] Prisma order repository
[3] Settlement orchestration
[4] Prisma schema
[5] Aggregator contracts and stand-ins
[6] Printing service output model
[7] Webhook idempotency E2E scenario
[8] Playwright configuration
[9] Existing UI wiring audit
[10] Central decision log


