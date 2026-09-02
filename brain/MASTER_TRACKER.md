# PETPOOJA POS - MASTER BRAIN & IMPLEMENTATION TRACKER

This document serves as the persistent "brain" of the project. It tracks our phase, current state, and the comprehensive list of real-world operational gaps that must be closed before the product is 100% hotel-ready.

## CURRENT STATE
- **Last Status:** Core backend wiring completed (Order lifecycle, KOT cascades, Settlement transactions, and Business Day enforcement are synchronized).
- **Active Phase:** PHASE 1 - Inventory & Procurement Integrity
- **Overall Progress:** ~80% Complete. The focus is now on deep operational edge cases, resilience, and UI/backend synchronization.

---

## DEEP GAP ANALYSIS (Hotel Manager Perspective)

### 1. Procurement & Inventory (PHASE 1)
- `[ ]` **Goods Received Note (GRN) Actualization:** Creating a GRN currently does not idempotently increase `current_stock_qty` in the ledger.
- `[ ]` **Wastage Logging:** No dedicated UI or API to log food spoilage/wastage which should deduct stock and hit a specific finance ledger COA.
- `[ ]` **Vendor Payments:** Purchase Orders (POs) lack a payable finance integration.

### 2. Finance & Ledger (PHASE 2)
- `[ ]` **Petty Cash UI:** Managers need an interactive form to log daily expenses (milk, ice) which debits the `cash_drawer_sessions`.
- `[ ]` **Shift Close Lock (Z-Report):** Closing the drawer must compare physical vs. expected cash, log variance, lock the session, and prevent any new bills until the next shift.
- `[ ]` **Card/EDC Settlement:** Ability to reconcile the batch total from the swiping machine against the system's `UPI/CARD` total.

### 3. Sales & Order Operations (PHASE 3)
- `[ ]` **Split Payments / Split Bill:** Diners at a table often pay partially in cash, partially on card. The backend `recordPayment` supports this, but the UI billing view lacks the split-payment flow.
- `[ ]` **Discount Auth Limits:** Waiters should only be able to discount up to 10%. Managers up to 100%. Missing UI validation for RBAC discount limits.

### 4. Kitchen & Production (PHASE 4)
- `[ ]` **SLA Tracking (Bump Times):** The time between KOT `CONFIRMED` -> `PREPARING` -> `READY` is not being aggregated for the Kitchen Analytics SLA view.
- `[ ]` **Scheduled Firing (Advance Orders):** Catering/Advance orders must be held in an `OUTBOX` or cron queue and only fire to the Kitchen/KDS at `scheduledFireAt - preparationTime`.

### 5. Customer & Online Channels (PHASE 5)
- `[ ]` **Delivery Address Book:** Online orders must map to a `CustomerAddress`. The schema has `delivery_address_id` but the UI lacks a way to select/create it.
- `[ ]` **Aggregator Gateway (Webhooks):** Zomato/Swiggy orders need a mock webhook receiver to hit the API, map items to POS IDs, and auto-print KOTs without manual entry.

### 6. Menu Management (PHASE 6)
- `[ ]` **Modifier Enforcement:** `minSelections` and `maxSelections` (e.g., "Choose exactly 2 sides") must be strictly validated in both the POS UI (ItemToggleModal) and the API.
- `[ ]` **Bulk Importer:** A CSV uploader for new restaurants to ingest 100+ items at once.

### 7. Waiter App & Captain Operations (PHASE 7)
- `[ ]` **Service Charge / Tip Calc:** Waiter UI needs to display earned tips or service charge cuts for the shift.
- `[ ]` **Offline Queue:** If the Captain app loses WiFi in a dead zone on the floor, adding items should queue locally and sync UUIDv7 outbox events when reconnected.

---

## EXECUTION LOG

### Phase 1: Procurement & Inventory Integrity
- *Status:* In Progress
- *Next Steps:* Implement GRN stock increment in API, and wire Wastage logging endpoint.
