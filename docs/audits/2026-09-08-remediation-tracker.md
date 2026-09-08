# Remediation Tracker — 2026-09-08 Audit

**Purpose:** This document converts every actionable finding from the 2026-09-08 infrastructure and codebase audit into individually trackable remediation items. Each row represents a discrete unit of work required to bring the Kapmeta project from its current state to the target production-ready state. All items are initialized with `Status = NOT_STARTED` and will be updated as work is assigned, implemented, and verified.

**Audit Date:** 2026-09-08  
**Scope:** Database migrations, Prisma schema, service layer, API routes, admin UI, infrastructure, CI/CD, and code quality  
**Total Items:** 19  
**Generated:** 2026-09-08

---

## Tracking Table

| ID | Priority | Audit Reference | Issue | Current State | Target State | Dependencies | Implementation Plan | Verification Requirements | Test Requirements | Status | Commit | Evidence/Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-001 | P0 | Infrastructure / DB | Migration conflict resolution (two parallel migration sets with duplicate numbering 0001-0009 in db/migrations/) | Two separate migration directories exist with overlapping sequential names (0001-0009), creating ambiguity for `prisma migrate deploy` and schema reconciliation. | Single authoritative migration directory with unique, non-conflicting filenames; `prisma migrate status` reports no drift. | R-002 | 1. Audit both migration directories to map equivalence. 2. Retain the set that matches `schema.prisma`. 3. Archive or delete the obsolete set. 4. Run `prisma migrate dev` / `deploy` to validate. | `prisma migrate status` shows no pending migrations. Single source of truth for schema history. | Integration test: apply all migrations to a fresh Postgres instance and assert schema matches `schema.prisma`. | NOT_STARTED | — | Two directories under `db/migrations/` contain `0001_*.sql` through `0009_*.sql`. |
| R-002 | P0 | Infrastructure / DB | Prisma schema alignment with migrations (schema matches neither migration set) | `schema.prisma` does not reflect the state of either migration directory; drift exists between model definitions and actual database schema. | `schema.prisma` is fully aligned with the retained migration set; `prisma migrate diff` reports zero drift. | R-001 | 1. Generate baseline SQL from the chosen migration set. 2. Update `schema.prisma` to match baseline. 3. Apply migrations to a clean database and introspect. 4. Resolve any remaining differences. | `prisma migrate diff --from-url ... --to-schema-datamodel schema.prisma` returns no differences. | Integration test: migrate fresh DB, run Prisma introspection, diff against `schema.prisma`. | NOT_STARTED | — | Root cause is parallel migration authorship without a single source of truth. |
| R-003 | P0 | Infrastructure / Services | Redis connection implementation (declared in .env, zero code references) | `REDIS_URL` is present in `.env` but no application code connects to Redis; session store, cache, and rate limiter are not operational. | Redis client initialized at application startup; connection health-checked; at least one production feature (session store or cache) uses Redis. | — | 1. Add Redis SDK dependency. 2. Implement connection singleton in `apps/api/src/lib/redis.ts`. 3. Wire into session middleware or cache layer. 4. Add startup health check and graceful shutdown. | Application boots with Redis connected; `redis-cli ping` succeeds from app container. | Unit test: mock Redis, assert connection singleton resolves. Integration test: app starts, Redis reachable, session stored in Redis. | NOT_STARTED | — | `.env` contains `REDIS_URL`; `grep -r "REDIS_URL" apps/` returns no hits. |
| R-004 | P0 | Infrastructure / Services | RabbitMQ connection implementation (QUEUE_URL declared, zero code references) | `QUEUE_URL` is declared in `.env` but no code consumes or publishes to RabbitMQ; async event processing is absent. | RabbitMQ client initialized; event publisher and consumer implemented; at least one domain event (e.g., `OrderCreated`) flows through the broker. | R-003 (recommended, not blocking) | 1. Add AMQP client dependency. 2. Implement connection/channel setup. 3. Define exchange, queue, and routing keys. 4. Replace `EventEmitter`-based internal bus with broker publisher. 5. Add consumer workers for critical domains. | `QUEUE_URL` resolved; `amqp-connection-manager` reports connected; message published and consumed end-to-end. | Integration test: publish event to test queue, consume and assert payload integrity. | NOT_STARTED | — | `QUEUE_URL` present in `.env`; zero imports of `amqplib` or equivalent in `apps/api/src/`. |
| R-005 | P1 | API / Contracts | Tax API route implementation (contracts/tax.yaml exists, no apps/api/src/routes/tax.ts, not mounted in app.ts, not in redocly.yaml apis) | OpenAPI contract for tax exists but no corresponding route implementation, router registration, or redocly registry entry. | `apps/api/src/routes/tax.ts` implemented, mounted in `app.ts`, and registered in `redocly.yaml`; contract and implementation are in sync. | R-002 | 1. Scaffold `apps/api/src/routes/tax.ts` with CRUD handlers matching `contracts/tax.yaml`. 2. Register router in `apps/api/src/app.ts`. 3. Add `tax.yaml` to `redocly.yaml` apis list. 4. Implement validation middleware. 5. Connect to Prisma tax repository. | `GET /api/tax` and `POST /api/tax` return 200 with valid payloads; redocly lint passes. | Contract test: validate responses against `contracts/tax.yaml`. Unit test: tax service logic. | NOT_STARTED | — | `contracts/tax.yaml` exists; `apps/api/src/routes/tax.ts` does not exist. |
| R-006 | P1 | API / Client | Real KapmetaApiClient HTTP implementation (InMemoryMockApiClient only, used only in tests) | `KapmetaApiClient` is backed by `InMemoryMockApiClient`; no production HTTP client exists for external API communication. | `KapmetaApiClient` uses a real HTTP client with retry, timeout, and error handling; mock is confined to test fixtures. | — | 1. Define HTTP client interface in `apps/api/src/lib/http-client.ts`. 2. Implement `KapmetaApiClient` against interface. 3. Add retry, circuit breaker, and structured logging. 4. Replace mock injection in app bootstrap with real client. 5. Keep mock available under `__tests__/`. | `KapmetaApiClient` makes real HTTP requests; mocks are only imported in test files. | Unit test: mock HTTP layer, assert retry logic. Integration test: hit staging API, assert response mapping. | NOT_STARTED | — | `grep -r "InMemoryMockApiClient" apps/api/src/` shows it is the only implementation. |
| R-007 | P1 | Admin / Persistence | Admin persistence (services/admin uses InMemoryRepository, not persisted) | Admin service layer uses `InMemoryRepository`; all data is lost on restart; no database-backed admin store exists. | Admin entities (users, settings, outlets) persisted in Postgres via Prisma; `InMemoryRepository` removed from production code. | R-002 | 1. Define Prisma models for admin domain entities. 2. Create `PgAdminRepository` implementing the repository interface. 3. Update DI container to resolve `PgAdminRepository` in production. 4. Remove `InMemoryRepository` from production bootstrap. 5. Backfill existing in-memory state if needed. | Admin data survives process restart; Prisma Studio shows admin records. | Integration test: create admin entity via service, restart process, read entity back. | NOT_STARTED | — | `apps/api/src/services/admin/repository.ts` exports `InMemoryRepository`. |
| R-008 | P1 | Admin / Web | admin-web application build (all 3 scripts are echo placeholders) | `apps/admin-web/package.json` scripts (`dev`, `build`, `start`) are `echo` placeholders; no functional admin web app can be run. | `admin-web` builds and serves a functional UI; scripts invoke real Vite / Next.js / equivalent commands. | — | 1. Initialize admin web framework (e.g., Vite + React) in `apps/admin-web`. 2. Replace placeholder scripts with real build/dev/start commands. 3. Add basic admin dashboard shell. 4. Proxy API requests to `apps/api`. 5. Verify production build output. | `npm run dev` starts dev server; `npm run build` produces `dist/`; `npm run start` serves built assets. | Smoke test: load admin UI, assert proxy to API succeeds, UI renders without console errors. | NOT_STARTED | — | `apps/admin-web/package.json` scripts contain only `echo "..."`. |
| R-009 | P1 | API / Auth | MFA implementation (documented in OpenAPI, not wired in auth.ts) | MFA endpoints and schemas are defined in OpenAPI but `apps/api/src/routes/auth.ts` does not implement MFA enrollment, challenge, or verification flows. | MFA fully implemented: TOTP enrollment, QR code generation, challenge/verify endpoints, and database-backed MFA secrets. | R-007 | 1. Add `mfa_secret` and `mfa_enabled` fields to admin user model. 2. Implement `POST /auth/mfa/enroll` and `POST /auth/mfa/verify`. 3. Integrate TOTP library (e.g., `otplib`). 4. Update login flow to require MFA when enabled. 5. Add recovery codes. | Admin can enable MFA; login prompts for TOTP; invalid codes rejected; recovery flow works. | Unit test: TOTP generation and verification. Integration test: full enroll → login → verify flow. | NOT_STARTED | — | `contracts/auth.yaml` defines MFA schemas; `auth.ts` contains no MFA logic. |
| R-010 | P2 | Infrastructure / Docker | Docker configuration (infra/docker/ has only .gitkeep, no docker-compose.yml or Dockerfile) | `infra/docker/` is an empty directory; no containerization exists for API, admin-web, database, Redis, or RabbitMQ. | `Dockerfile` and `docker-compose.yml` present; `docker compose up` brings up the entire stack locally and in CI. | R-003, R-004, R-008 | 1. Write multi-stage `Dockerfile` for `apps/api`. 2. Write multi-stage `Dockerfile` for `apps/admin-web`. 3. Create `docker-compose.yml` with postgres, redis, rabbitmq, api, admin-web services. 4. Add healthchecks and dependency ordering. 5. Document `docker compose up` workflow. | `docker compose up --build` succeeds; all services healthy; API reachable on port 3000; admin-web on 5173. | Smoke test: run compose, hit health endpoints, assert all services respond. | NOT_STARTED | — | `infra/docker/` contains only `.gitkeep`. |
| R-011 | P2 | CI/CD | CI/CD pipeline enhancement (ci.yml exists but only runs lint/typecheck/test/contracts/security - no build, no deploy) | `.github/workflows/ci.yml` runs quality gates but does not build Docker images or deploy to any environment. | CI builds container images, pushes to registry, and deploys to staging/production via environment-specific jobs. | R-010 | 1. Add `docker build` and `docker push` steps to CI. 2. Create staging deploy job (e.g., Render, Fly.io, or EC2). 3. Create production deploy job with manual approval gate. 4. Add deployment status badges. 5. Wire CI to run database migrations post-deploy. | CI passes; Docker image published; staging environment updated; production deploy requires manual approval. | Pipeline test: trigger CI on PR, assert image built, staging deploy succeeds. | NOT_STARTED | — | `.github/workflows/ci.yml` contains no `docker` or `deploy` steps. |
| R-012 | P2 | Code Quality | Remove hardcoded demo data (QUICK_ROLES in login.tsx, hardcoded menu items in ApiClient.ts, hardcoded UUID in seed-dynamic-data.ts) | Multiple UI and seed files contain hardcoded business data (roles, menu items, UUIDs) instead of fetching from the database or config. | All demo/seed data sourced from database seeds or environment configuration; zero hardcoded business literals in source files. | R-007 | 1. Replace `QUICK_ROLES` in `login.tsx` with API call to roles endpoint. 2. Replace hardcoded menu items in `ApiClient.ts` with dynamic menu fetch. 3. Replace hardcoded UUID in `seed-dynamic-data.ts` with database-generated ID or seeded config. 4. Add seed script for required lookup data. | `grep -r "QUICK_ROLES\|MenuItem\|hardcoded.*UUID" apps/` returns no production hits. | E2E test: login page loads roles from API; menu renders from backend; seed script runs without hardcoded IDs. | NOT_STARTED | — | `apps/admin-web/src/pages/login.tsx`, `apps/admin-web/src/lib/api/ApiClient.ts`, `apps/api/src/scripts/seed-dynamic-data.ts`. |
| R-013 | P2 | API / Contracts | redocly.yaml tax API entry (tax.yaml not listed in redocly.yaml apis) | `contracts/tax.yaml` is not registered in `redocly.yaml`; tax API is excluded from linting and documentation generation. | `tax.yaml` listed under `apis` in `redocly.yaml`; `redocly lint` validates tax contract successfully. | R-005 | 1. Add `tax.yaml` entry to `redocly.yaml` apis array. 2. Run `redocly lint` to validate. 3. Regenerate API docs if applicable. 4. Add lint step to CI if missing. | `redocly lint contracts/tax.yaml` passes; tax API appears in generated docs. | Contract test: redocly lint returns zero errors for tax.yaml. | NOT_STARTED | — | `contracts/tax.yaml` exists; `redocly.yaml` apis list does not include it. |
| R-014 | P2 | Code Quality | Pg*Repository dead code cleanup (raw-SQL repositories exist but are not used by API routes) | Raw-SQL `Pg*Repository` classes exist in `apps/api/src/repositories/` but are not injected into any API route or service; dead code increases maintenance surface. | Unused `Pg*Repository` classes removed or migrated to; only active repository implementations remain in production code paths. | R-007 | 1. Audit `apps/api/src/repositories/` for usage via `grep` and IDE references. 2. Confirm zero usage in `routes/` and `services/`. 3. Delete dead files or migrate callers to Prisma repositories. 4. Update barrel exports. 5. Run test suite to confirm no breakage. | `grep -r "Pg.*Repository" apps/api/src/routes apps/api/src/services` returns no hits; test suite passes. | Static analysis test: assert no imports of deleted modules remain. | NOT_STARTED | — | `apps/api/src/repositories/` contains multiple `Pg*Repository.ts` files. |
| R-015 | P2 | API / Client | Centralized HTTP client for POS Web (uses raw fetch() throughout, no retry/logging/type-safe wrapper) | `apps/admin-web/src/` uses raw `fetch()` with no centralized client; no retry, timeout, logging, or type-safe request/response contracts. | Shared `ApiClient` class wrapping `fetch` with interceptors, retry policy, request/response typing, and structured logging. | — | 1. Create `apps/admin-web/src/lib/http-client.ts` with typed methods. 2. Add retry with exponential backoff. 3. Add request/response logging with correlation IDs. 4. Migrate direct `fetch()` calls to `ApiClient`. 5. Add timeout and cancellation support. | All API calls route through `ApiClient`; network tab shows consistent headers; retries visible in logs on 502/503. | Unit test: mock fetch, assert retry on 503. Integration test: assert correlation IDs present in logs. | NOT_STARTED | — | Multiple files in `apps/admin-web/src/` call `fetch()` directly. |
| R-016 | P3 | Developer Experience | Makefile creation (no Makefile exists) | No `Makefile` exists; developers must remember long npm scripts and Docker commands with no standard entry points. | `Makefile` at repo root with targets for `install`, `dev`, `test`, `lint`, `build`, `docker-up`, `docker-down`, `migrate`, and `seed`. | — | 1. Create `Makefile` with phony targets. 2. Wrap `npm run` commands for API and admin-web. 3. Add Docker orchestration targets. 4. Add database migration and seed targets. 5. Document `make help`. | `make help` lists all targets; `make dev` boots both apps; `make test` runs full suite. | Manual verification: each target executes correctly on a fresh clone. | NOT_STARTED | — | No `Makefile` or `makefile` exists at repo root. |
| R-017 | P3 | API / Contracts | Tax route redocly validation (tax.yaml needs to be added to redocly.yaml and validated) | `tax.yaml` is absent from `redocly.yaml`; tax contract is not linted or versioned with the rest of the API surface. | `tax.yaml` registered in `redocly.yaml`; CI runs `redocly lint` against all registered contracts including tax. | R-013 | 1. Add `tax.yaml` to `redocly.yaml` apis. 2. Run `redocly lint contracts/tax.yaml` locally. 3. Fix any schema errors. 4. Add lint step to CI workflow. 5. Tag contract version. | `redocly lint` passes for all contracts; CI reports zero contract errors. | CI test: open PR modifying `tax.yaml`, assert redocly lint job runs and passes. | NOT_STARTED | — | `contracts/tax.yaml` exists but is invisible to redocly tooling. |
| R-018 | P3 | Architecture | Event bus migration from EventEmitter to real message broker (when R-004 is done) | Internal event system uses Node.js `EventEmitter`; events are synchronous and in-process only, not durable or distributed. | Events published to RabbitMQ; consumers process asynchronously; events survive process restarts. | R-004 | 1. Define event schemas (e.g., `OrderCreated`, `InvoicePaid`). 2. Implement publisher that replaces `eventBus.emit()` with `channel.publish()`. 3. Implement consumer workers with DLQ support. 4. Remove `EventEmitter` from domain services. 5. Add event replay or idempotency keys. | `EventEmitter` no longer imported in domain services; RabbitMQ management UI shows queues with messages. | Integration test: publish event, assert consumer processes and side effects occur (e.g., email sent, cache invalidated). | NOT_STARTED | — | `apps/api/src/lib/event-bus.ts` uses `EventEmitter`. |
| R-019 | P3 | Infrastructure / Services | Session store migration from Prisma to Redis (when R-003 is done) | Session state is stored via Prisma adapter; every session read/write hits Postgres, increasing DB load and latency. | Session store backed by Redis; Prisma session table deprecated or removed; sessions accessed in O(1) with TTL support. | R-003 | 1. Evaluate session store requirements (TTL, size, serialization). 2. Implement Redis session store adapter. 3. Update session middleware to use Redis. 4. Run dual-write migration if needed. 5. Decommission Prisma session table after validation. | Session reads/writes no longer appear in Postgres query logs; Redis keyspace shows active sessions with TTL. | Load test: simulate 1000 concurrent sessions, assert Redis handles without DB saturation. | NOT_STARTED | — | `apps/api/src/middleware/session.ts` uses Prisma session store. |

---

## Dependency Analysis

The following execution order minimizes rework and ensures foundational layers are stable before dependent features are built.

### Blocking Dependencies

- **R-001** must complete before **R-002** because schema alignment requires a single authoritative migration history.
- **R-002** must complete before **R-005**, **R-007**, and **R-014** because those items depend on a correct Prisma schema and baseline migrations.
- **R-003** must complete before **R-004** (recommended), **R-010**, **R-019** because Redis is a prerequisite for session store migration and local Docker compose.
- **R-004** must complete before **R-018** because the event bus migration requires a live RabbitMQ connection.
- **R-007** must complete before **R-009** because MFA implementation requires persisted admin user records.

### Parallel Opportunities

- **R-003**, **R-004**, and **R-008** can proceed in parallel after **R-001** and **R-002** are resolved, as they touch different subsystems (infrastructure, messaging, admin-web).
- **R-005**, **R-006**, and **R-015** can proceed in parallel once **R-002** is complete, as they are isolated to API routes and the admin-web client.
- **R-012** and **R-014** can run in parallel after **R-007**, as they are cleanup tasks with no cross-dependencies.
- **R-010** and **R-011** can proceed in parallel once **R-003**, **R-004**, **R-008**, and **R-002** are complete, because CI/CD and Docker need the underlying services to be functional.

### Critical Path

```
R-001 → R-002 → R-007 → R-009
                → R-005
                → R-014
                → R-010 → R-011
R-003 → R-010
       → R-019
R-004 → R-018
```

---

## Phases Summary

### Phase 1: Foundation (P0)
**Goal:** Stabilize database, schema, and service connectivity.

| ID | Title | Owner | Target Completion |
|---|---|---|---|
| R-001 | Migration conflict resolution | — | — |
| R-002 | Prisma schema alignment with migrations | — | — |
| R-003 | Redis connection implementation | — | — |
| R-004 | RabbitMQ connection implementation | — | — |

### Phase 2: Feature Completeness (P1)
**Goal:** Close functional gaps between contracts and implementation.

| ID | Title | Owner | Target Completion |
|---|---|---|---|
| R-005 | Tax API route implementation | — | — |
| R-006 | Real KapmetaApiClient HTTP implementation | — | — |
| R-007 | Admin persistence | — | — |
| R-008 | admin-web application build | — | — |
| R-009 | MFA implementation | — | — |

### Phase 3: Hardening & Cleanup (P2)
**Goal:** Productionize infrastructure, CI/CD, and code quality.

| ID | Title | Owner | Target Completion |
|---|---|---|---|
| R-010 | Docker configuration | — | — |
| R-011 | CI/CD pipeline enhancement | — | — |
| R-012 | Remove hardcoded demo data | — | — |
| R-013 | redocly.yaml tax API entry | — | — |
| R-014 | Pg*Repository dead code cleanup | — | — |
| R-015 | Centralized HTTP client for POS Web | — | — |

### Phase 4: Operational Excellence (P3)
**Goal:** Improve developer experience and long-term maintainability.

| ID | Title | Owner | Target Completion |
|---|---|---|---|
| R-016 | Makefile creation | — | — |
| R-017 | Tax route redocly validation | — | — |
| R-018 | Event bus migration from EventEmitter to real message broker | — | — |
| R-019 | Session store migration from Prisma to Redis | — | — |

---

*End of remediation tracker.*
