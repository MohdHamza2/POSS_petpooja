import { describe, it, expect } from "vitest";
import { priceOrder, createOrder, transitionOrder, listOrders, getOrderDetail } from "./order-service";
import type { MenuPriceLookup, OrderRepository, OrderSummary, OrderDetail, ListOrdersFilter } from "./order-service";
import { isTransitionLegal, ORDER_TRANSITIONS } from "@kapmeta/shared-types/orders";
import type { OrderStatus, CreateOrderInput, OrderLineInput, PricedOrder } from "@kapmeta/shared-types/orders";

function priceMap(entries: [string, bigint, number?][]): Map<string, { priceMinor: bigint; taxRatePercent: number }> {
  return new Map(entries.map(([id, priceMinor, taxRatePercent = 0]) => [id, { priceMinor, taxRatePercent }]));
}

describe("priceOrder", () => {
  it("computes correct subtotal/grandTotal for multiple lines with different quantities", () => {
    const lines: OrderLineInput[] = [
      { menuItemId: "a", quantity: 2, modifierOptionIds: [] },
      { menuItemId: "b", quantity: 3, modifierOptionIds: [] },
    ];
    const prices = priceMap([
      ["a", 100n],
      ["b", 50n],
    ]);

    const result = priceOrder(lines, prices);

    expect(result.subtotalMinor).toBe(350n);
    expect(result.grandTotalMinor).toBe(350n);
    expect(result.lines).toEqual([
      { menuItemId: "a", quantity: 2, unitPriceMinor: 100n, subtotalMinor: 200n, taxMinor: 0n, modifiers: [], course: undefined, seatNumber: undefined },
      { menuItemId: "b", quantity: 3, unitPriceMinor: 50n, subtotalMinor: 150n, taxMinor: 0n, modifiers: [], course: undefined, seatNumber: undefined },
    ]);
  });

  it("throws when a line's menuItemId isn't in the prices map", () => {
    const lines: OrderLineInput[] = [{ menuItemId: "missing", quantity: 1, modifierOptionIds: [] }];
    const prices = priceMap([]);

    expect(() => priceOrder(lines, prices)).toThrow(/no price found for menu item missing/);
  });

  it("zero tax rate produces zero tax", () => {
    const lines: OrderLineInput[] = [{ menuItemId: "a", quantity: 5, modifierOptionIds: [] }];
    const prices = priceMap([["a", 999n, 0]]);

    const result = priceOrder(lines, prices);

    expect(result.taxTotalMinor).toBe(0n);
  });

  it("backs out the inclusive tax component without changing the charged total (DEC-004)", () => {
    // 105 minor units at 5% inclusive GST => tax component is 5 (105 - 105/1.05 = 5)
    const lines: OrderLineInput[] = [{ menuItemId: "a", quantity: 1, modifierOptionIds: [] }];
    const prices = priceMap([["a", 105n, 5]]);

    const result = priceOrder(lines, prices);

    expect(result.lines[0].taxMinor).toBe(5n);
    expect(result.subtotalMinor).toBe(105n);
    // Inclusive tax: grand total is unchanged by the tax breakdown.
    expect(result.grandTotalMinor).toBe(105n);
  });

  it("adds modifier option surcharges (scaled by quantity) into the line and order totals", () => {
    const lines: OrderLineInput[] = [
      { menuItemId: "a", quantity: 2, modifierOptionIds: ["extra-cheese", "extra-spicy"] },
    ];
    const prices = priceMap([["a", 100n]]);
    const modifierPrices = new Map<string, bigint>([
      ["extra-cheese", 20n],
      ["extra-spicy", 10n],
    ]);

    const result = priceOrder(lines, prices, modifierPrices);

    // unit: 100 base + 20 + 10 modifiers = 130; qty 2 => 260
    expect(result.lines).toEqual([
      {
        menuItemId: "a",
        quantity: 2,
        unitPriceMinor: 100n,
        subtotalMinor: 260n,
        taxMinor: 0n,
        modifiers: [
          { modifierOptionId: "extra-cheese", priceMinor: 20n },
          { modifierOptionId: "extra-spicy", priceMinor: 10n },
        ],
        course: undefined,
        seatNumber: undefined,
      },
    ]);
    expect(result.subtotalMinor).toBe(260n);
    expect(result.grandTotalMinor).toBe(260n);
  });

  it("a line with no modifiers is unaffected (regression) even when a modifierPrices map is supplied", () => {
    const lines: OrderLineInput[] = [{ menuItemId: "a", quantity: 3, modifierOptionIds: [] }];
    const prices = priceMap([["a", 100n]]);
    const modifierPrices = new Map<string, bigint>([["unrelated-modifier", 50n]]);

    const result = priceOrder(lines, prices, modifierPrices);

    expect(result.lines).toEqual([
      { menuItemId: "a", quantity: 3, unitPriceMinor: 100n, subtotalMinor: 300n, taxMinor: 0n, modifiers: [], course: undefined, seatNumber: undefined },
    ]);
    expect(result.subtotalMinor).toBe(300n);
  });

  it("throws when a line's modifierOptionId isn't in the modifierPrices map", () => {
    const lines: OrderLineInput[] = [{ menuItemId: "a", quantity: 1, modifierOptionIds: ["missing-modifier"] }];
    const prices = priceMap([["a", 100n]]);
    const modifierPrices = new Map<string, bigint>();

    expect(() => priceOrder(lines, prices, modifierPrices)).toThrow(
      /no price found for modifier option missing-modifier/
    );
  });
});

describe("isTransitionLegal", () => {
  it("returns true for every legal transition in ORDER_TRANSITIONS", () => {
    for (const from of Object.keys(ORDER_TRANSITIONS) as OrderStatus[]) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(isTransitionLegal(from, to)).toBe(true);
      }
    }
  });

  it("returns false for a sample of illegal transitions", () => {
    expect(isTransitionLegal("DRAFT", "COMPLETED")).toBe(false);
    expect(isTransitionLegal("COMPLETED", "DRAFT")).toBe(false);
    expect(isTransitionLegal("COMPLETED", "CANCELLED")).toBe(false);
    expect(isTransitionLegal("COMPLETED", "COMPLETED")).toBe(false);
    expect(isTransitionLegal("PLACED", "READY")).toBe(false);
  });
});

// Methods exercised by their own dedicated tests elsewhere (or not at all
// yet) — stubbed here so the fakes satisfy the full OrderRepository shape
// without every listOrders/createOrder test needing to care about them.
const unusedRepoStubs = {
  async countOrders() {
    return 0;
  },
  async getRevenueTrend() {
    return [];
  },
  async getLiveOrderByTable() {
    return null;
  },
  async addItems() {
    return [];
  },
  async voidItem() {
    return { ok: false as const };
  },
  async getBill() {
    return null;
  },
  async getBillBySeat() {
    return [];
  },
  async setCharges() {
    return { tipTotalMinor: 0n, serviceChargeTotalMinor: 0n, grandTotalMinor: 0n };
  },
  async recordPayment() {
    return { id: "stub-payment", amountMinor: 0n, method: "CASH", status: "CAPTURED" };
  },
};

function makeFakeOrderRepo() {
  const byId = new Map<string, { id: string; status: OrderStatus }>();
  const byIdempotencyKey = new Map<string, string>();

  const repo: OrderRepository = {
    ...unusedRepoStubs,
    async nextOrderNumber() {
      return `TEST-${byId.size + 1}`;
    },
    async findByIdempotencyKey(idempotencyKey: string) {
      const id = byIdempotencyKey.get(idempotencyKey);
      if (!id) return null;
      return byId.get(id) ?? null;
    },
    async createOrder(id, input, _priced: PricedOrder, _orderNumber) {
      const record = { id, status: "DRAFT" as OrderStatus };
      byId.set(id, record);
      byIdempotencyKey.set(input.idempotencyKey, id);
      return record;
    },
    async getStatus(orderId: string) {
      return byId.get(orderId)?.status ?? null;
    },
    async recordTransition(orderId: string, newStatus: OrderStatus) {
      const record = byId.get(orderId);
      if (record) record.status = newStatus;
    },
    async listOrders() {
      return [];
    },
    async getOrderDetail() {
      return null;
    },
  };

  return repo;
}

// Fake repo purely for exercising listOrders' filter-forwarding contract —
// the real filtering logic lives in PrismaOrderRepository (a Prisma query),
// so these tests only assert order-service.listOrders passes the filter and
// outletId through untouched and returns what the repo gives back.
function makeFakeListingRepo(seed: OrderSummary[]) {
  let capturedOutletId: string | undefined;
  let capturedFilter: ListOrdersFilter | undefined;

  const repo: OrderRepository = {
    ...unusedRepoStubs,
    async nextOrderNumber() {
      return "TEST-1";
    },
    async findByIdempotencyKey() {
      return null;
    },
    async createOrder(id) {
      return { id, status: "DRAFT" as OrderStatus };
    },
    async getStatus() {
      return null;
    },
    async recordTransition() {},
    async listOrders(outletId: string, filter: ListOrdersFilter) {
      capturedOutletId = outletId;
      capturedFilter = filter;

      // Emulate the real Prisma repo's view semantics closely enough to
      // verify order-service wires filters through correctly.
      return seed.filter((order) => {
        if (filter.view === "live") {
          return !["COMPLETED", "CANCELLED", "FAILED"].includes(order.status);
        }
        if (filter.view === "online") {
          return order.orderType === "AGGREGATOR";
        }
        if (filter.status && order.status !== filter.status) return false;
        if (filter.orderType && order.orderType !== filter.orderType) return false;
        return true;
      });
    },
    async getOrderDetail() {
      return null;
    },
  };

  return {
    repo,
    getCaptured: () => ({ outletId: capturedOutletId, filter: capturedFilter }),
  };
}

function makeInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    outletId: "outlet-1",
    terminalNumber: "T1",
    orderType: "DINE_IN",
    idempotencyKey: "key-1",
    lines: [{ menuItemId: "a", quantity: 1, modifierOptionIds: [] }],
    ...overrides,
  };
}

describe("createOrder", () => {
  it("returns alreadyExisted:true on repeated idempotencyKey and does not call price lookup again", async () => {
    const repo = makeFakeOrderRepo();
    let priceLookupCalls = 0;
    const priceLookup: MenuPriceLookup = {
      async getPrice(menuItemId: string, _outletId: string) {
        priceLookupCalls++;
        return { priceMinor: 100n, taxRatePercent: 0 };
      },
    };

    const input = makeInput();

    const first = await createOrder(input, priceLookup, repo);
    expect(first.alreadyExisted).toBe(false);
    expect(priceLookupCalls).toBe(1);

    const second = await createOrder(input, priceLookup, repo);
    expect(second.alreadyExisted).toBe(true);
    expect(second.id).toBe(first.id);
    expect(priceLookupCalls).toBe(1);
  });

  it("passes per-line modifier ids and prices through to the repository for audit-trail persistence", async () => {
    const repo = makeFakeOrderRepo();
    let capturedPriced: PricedOrder | undefined;
    const originalCreateOrder = repo.createOrder.bind(repo);
    repo.createOrder = async (id, input, priced, orderNumber) => {
      capturedPriced = priced;
      return originalCreateOrder(id, input, priced, orderNumber);
    };

    const priceLookup: MenuPriceLookup = {
      async getPrice() {
        return { priceMinor: 100n, taxRatePercent: 0 };
      },
    };
    const modifierPriceLookup = {
      async getPrices(modifierOptionIds: string[], _outletId: string) {
        return new Map(modifierOptionIds.map((modifierOptionId) => [modifierOptionId, 25n]));
      },
    };

    const input = makeInput({
      idempotencyKey: "key-modifiers",
      lines: [{ menuItemId: "a", quantity: 2, modifierOptionIds: ["extra-cheese", "extra-spicy"] }],
    });

    await createOrder(input, priceLookup, repo, modifierPriceLookup);

    expect(capturedPriced?.lines).toEqual([
      {
        menuItemId: "a",
        quantity: 2,
        unitPriceMinor: 100n,
        subtotalMinor: 300n, // (100 + 25 + 25) * 2
        taxMinor: 0n,
        modifiers: [
          { modifierOptionId: "extra-cheese", priceMinor: 25n },
          { modifierOptionId: "extra-spicy", priceMinor: 25n },
        ],
        course: undefined,
        seatNumber: undefined,
      },
    ]);
  });

  it("throws when price is missing", async () => {
    const repo = makeFakeOrderRepo();
    const priceLookup: MenuPriceLookup = {
      async getPrice() {
        return null;
      },
    };
    const input = makeInput({ idempotencyKey: "key-missing" });

    await expect(createOrder(input, priceLookup, repo)).rejects.toThrow(/no price found for menu item/);
  });
});

describe("transitionOrder", () => {
  it("succeeds on a legal transition", async () => {
    const repo = makeFakeOrderRepo();
    const priceLookup: MenuPriceLookup = {
      async getPrice() {
        return { priceMinor: 100n, taxRatePercent: 0 };
      },
    };
    const input = makeInput({ idempotencyKey: "key-legal" });
    const created = await createOrder(input, priceLookup, repo);

    const result = await transitionOrder(created.id, "PLACED", repo, "user-test");

    expect(result).toEqual({ ok: true, newStatus: "PLACED" });
  });

  it("returns ILLEGAL_TRANSITION shape on an illegal transition", async () => {
    const repo = makeFakeOrderRepo();
    const priceLookup: MenuPriceLookup = {
      async getPrice() {
        return { priceMinor: 100n, taxRatePercent: 0 };
      },
    };
    const input = makeInput({ idempotencyKey: "key-illegal" });
    const created = await createOrder(input, priceLookup, repo);

    const result = await transitionOrder(created.id, "COMPLETED", repo, "user-test");

    expect(result).toEqual({ ok: false, reason: "ILLEGAL_TRANSITION", from: "DRAFT", to: "COMPLETED" });
  });

  it("returns not-found shape for a nonexistent orderId", async () => {
    const repo = makeFakeOrderRepo();

    const result = await transitionOrder("nonexistent-id", "PLACED", repo, "user-test");

    expect(result).toEqual({ ok: false, reason: "ILLEGAL_TRANSITION", from: "FAILED", to: "PLACED" });
  });
});

function makeSampleOrders(): OrderSummary[] {
  const base = {
    diningTableId: null,
    channel: null,
    externalOrderId: null,
    priceMismatch: false,
    taxTotalMinor: 0n,
    discountTotalMinor: 0n,
    customerName: null,
    waiterName: null,
    paymentMethod: null,
  };
  return [
    { ...base, id: "o1", orderNumber: "ORD-1", orderType: "DINE_IN", status: "PLACED", grandTotalMinor: 100n, createdAt: new Date("2026-01-01"), itemCount: 2 },
    { ...base, id: "o2", orderNumber: "ORD-2", orderType: "DINE_IN", status: "COMPLETED", grandTotalMinor: 200n, createdAt: new Date("2026-01-02"), itemCount: 1 },
    { ...base, id: "o3", orderNumber: "ORD-3", orderType: "AGGREGATOR", status: "IN_PREPARATION", grandTotalMinor: 300n, createdAt: new Date("2026-01-03"), itemCount: 3 },
    { ...base, id: "o4", orderNumber: "ORD-4", orderType: "AGGREGATOR", status: "COMPLETED", grandTotalMinor: 400n, createdAt: new Date("2026-01-04"), itemCount: 4 },
    { ...base, id: "o5", orderNumber: "ORD-5", orderType: "DINE_IN", status: "CANCELLED", grandTotalMinor: 500n, createdAt: new Date("2026-01-05"), itemCount: 1 },
  ];
}

describe("listOrders", () => {
  it("view: 'live' returns only non-terminal-status orders", async () => {
    const { repo } = makeFakeListingRepo(makeSampleOrders());

    const result = await listOrders("outlet-1", { view: "live" }, repo);

    expect(result.map((o) => o.id).sort()).toEqual(["o1", "o3"]);
  });

  it("view: 'online' returns only AGGREGATOR orderType orders regardless of status", async () => {
    const { repo } = makeFakeListingRepo(makeSampleOrders());

    const result = await listOrders("outlet-1", { view: "online" }, repo);

    expect(result.map((o) => o.id).sort()).toEqual(["o3", "o4"]);
  });

  it("view: 'all' with no extra filter returns every order", async () => {
    const { repo } = makeFakeListingRepo(makeSampleOrders());

    const result = await listOrders("outlet-1", { view: "all" }, repo);

    expect(result).toHaveLength(5);
  });

  it("forwards outletId and the filter object untouched to the repository", async () => {
    const { repo, getCaptured } = makeFakeListingRepo(makeSampleOrders());
    const filter: ListOrdersFilter = { view: "live", limit: 10, offset: 5 };

    await listOrders("outlet-42", filter, repo);

    expect(getCaptured()).toEqual({ outletId: "outlet-42", filter });
  });

  it("status filter narrows results to a single status", async () => {
    const { repo } = makeFakeListingRepo(makeSampleOrders());

    const result = await listOrders("outlet-1", { status: "CANCELLED" as OrderStatus }, repo);

    expect(result.map((o) => o.id)).toEqual(["o5"]);
  });
});

describe("getOrderDetail", () => {
  it("returns null when the repository has no matching order", async () => {
    const repo = makeFakeOrderRepo();

    const result = await getOrderDetail("outlet-1", "missing-order", repo);

    expect(result).toBeNull();
  });

  it("returns whatever the repository resolves for a found order", async () => {
    const detail: OrderDetail = {
      id: "o1",
      orderNumber: "ORD-1",
      orderType: "DINE_IN",
      status: "PLACED",
      grandTotalMinor: 100n,
      subtotalMinor: 100n,
      taxTotalMinor: 0n,
      discountTotalMinor: 0n,
      terminalNumber: "T1",
      diningTableId: null,
      channel: null,
      externalOrderId: null,
      priceMismatch: false,
      customerId: null,
      customerPhone: null,
      customerName: null,
      waiterName: null,
      paymentMethod: null,
      createdAt: new Date("2026-01-01"),
      itemCount: 1,
      items: [],
      payments: [],
      statusHistory: [],
    };
    const repo: OrderRepository = {
      ...makeFakeOrderRepo(),
      async getOrderDetail() {
        return detail;
      },
    };

    const result = await getOrderDetail("outlet-1", "o1", repo);

    expect(result).toEqual(detail);
  });
});
