# Restaurant POS & Operations Platform

Multi-outlet restaurant POS, kitchen (KOT), menu/catalog, online aggregator integration, inventory, finance, CRM and reporting platform.

**Status:** Runnable POS — table floor, waiter, billing, kitchen, inventory, and finance. Clone the repo, migrate, seed, and run `npm run dev`.

## 👉 Developers: read [`docs/START-HERE.md`](docs/START-HERE.md) before writing any code.

It is the single entry point — system overview, role-based reading order, what is blocked by which decision, and the pre-code checklist. Then [`docs/ENGINEERING-PROTOCOL.md`](docs/ENGINEERING-PROTOCOL.md) for the rules that govern every PR.

## Repository Map

| Path | Purpose |
|------|---------|
| `docs/` | Full SDLC documentation, phase by phase |
| `docs/adr/` | Architecture Decision Records |
| `apps/` | Deployable frontends + API gateway (`pos-web`, `admin-web`, `api`) |
| `services/` | Domain modules (modular monolith today, extractable later) |
| `packages/` | Shared libs: types, UI kit, config |
| `db/` | PostgreSQL migrations, seeds, ERD |
| `contracts/` | OpenAPI specs, async event schemas, Postman collections |
| `infra/` | Terraform, Kubernetes, Docker, monitoring |
| `tests/` | Unit, contract, integration, e2e, smoke, performance, security suites |
| `logs/` | Local runtime log output (contents never committed) |
| `scripts/` | Dev/ops automation |
| `.github/` | CI/CD workflows, issue + PR templates |

## SDLC Phases

| Phase | Doc | Duration |
|-------|-----|----------|
| 0 Discovery | `docs/01-discovery/` | 2-3 wk |
| 1 UX/UI Design | `docs/04-design/` | 3-4 wk |
| 2-3 Architecture + DB | `docs/03-architecture/`, `docs/05-database/` | 4-6 wk |
| 4-6 Core POS | `docs/02-requirements/` | 8-12 wk |
| 7 Online Integration | `docs/07-integration/` | 4-6 wk |
| 8-9 Inventory + Finance | `docs/02-requirements/` | 6-10 wk |
| 10-11 CRM + Reporting | `docs/02-requirements/` | 6-8 wk |
| 12-15 Hardening | `docs/08-security/`, `docs/09-testing/` | 4-6 wk |
| 16 Rollout | `docs/11-rollout/` | 2-4 wk |

## Getting Started

PostgreSQL and Redis must be running locally. Default database name is `petpooja`.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run seed:dynamic
npm run dev
```

Then open the POS at http://localhost:4444 (API on http://localhost:4001).

`npm install` generates the Prisma client. `npm run db:migrate` applies SQL history and syncs `kapmeta/schema.prisma` so a fresh clone matches the running POS (tables, merge groups, inventory, finance).

## Governance

- Definition of Ready / Done: `docs/00-governance/definition-of-ready-done.md`
- Risk register: `docs/00-governance/risk-register.md`
- Change control: `docs/00-governance/change-control.md`
