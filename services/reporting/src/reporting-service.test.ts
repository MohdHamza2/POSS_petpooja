import { describe, it, expect } from "vitest";
import {
  computeSalesSummary,
  computeItemPerformance,
  computePaymentBreakdown,
  computeChannelBreakdown,
  computeTableTurnaroundAverage,
  computeLeakageReport,
} from "./reporting-service";
import type {
  OrderAggregateRow,
  ItemSaleRow,
  PaymentAggregateRow,
  ChannelOrderRow,
  DineInTurnaroundRow,
  KotLeakageEventRow,
  InvoiceLeakageRow,
  UnbilledKotRow,
} from "./reporting-service";
import { KPI_FORMULA_VERSION } from "@kapmeta/shared-types/reporting";

describe("computeSalesSummary", () => {
  const outletId = "outlet-1";
  const range = { fromDate: new Date("2026-01-01"), toDate: new Date("2026-01-31") };

  it("counts only COMPLETED orders toward orderCount and netSalesMinor", () => {
    const orders: OrderAggregateRow[] = [
      { status: "COMPLETED", grandTotalMinor: 1000n },
      { status: "CANCELLED", grandTotalMinor: 5000n },
      { status: "FAILED", grandTotalMinor: 3000n },
      { status: "DRAFT", grandTotalMinor: 2000n },
      { status: "COMPLETED", grandTotalMinor: 500n },
    ];

    const summary = computeSalesSummary(outletId, range, orders);

    expect(summary.orderCount).toBe(2);
    expect(summary.netSalesMinor).toBe(1500n);
  });

  it("computes averageOrderValueMinor as integer division", () => {
    const orders: OrderAggregateRow[] = [
      { status: "COMPLETED", grandTotalMinor: 1000n },
      { status: "COMPLETED", grandTotalMinor: 1000n },
      { status: "COMPLETED", grandTotalMinor: 1001n },
    ];

    const summary = computeSalesSummary(outletId, range, orders);

    expect(summary.orderCount).toBe(3);
    expect(summary.netSalesMinor).toBe(3001n);
    expect(summary.averageOrderValueMinor).toBe(1000n);
  });

  it("returns 0n averageOrderValueMinor with zero COMPLETED orders, no throw", () => {
    const orders: OrderAggregateRow[] = [
      { status: "CANCELLED", grandTotalMinor: 5000n },
      { status: "FAILED", grandTotalMinor: 3000n },
      { status: "DRAFT", grandTotalMinor: 2000n },
    ];

    expect(() => computeSalesSummary(outletId, range, orders)).not.toThrow();
    const summary = computeSalesSummary(outletId, range, orders);
    expect(summary.orderCount).toBe(0);
    expect(summary.averageOrderValueMinor).toBe(0n);
  });

  it("includes formulaVersion matching KPI_FORMULA_VERSION", () => {
    const orders: OrderAggregateRow[] = [{ status: "COMPLETED", grandTotalMinor: 1000n }];
    const summary = computeSalesSummary(outletId, range, orders);
    expect(summary.formulaVersion).toBe(KPI_FORMULA_VERSION);
  });
});

describe("computeItemPerformance", () => {
  it("counts only items from COMPLETED orders", () => {
    const items: ItemSaleRow[] = [
      { menuItemId: "item-a", quantity: 2, subtotalMinor: 400n, orderStatus: "COMPLETED" },
      { menuItemId: "item-b", quantity: 5, subtotalMinor: 1000n, orderStatus: "CANCELLED" },
      { menuItemId: "item-c", quantity: 1, subtotalMinor: 200n, orderStatus: "FAILED" },
      { menuItemId: "item-d", quantity: 1, subtotalMinor: 200n, orderStatus: "DRAFT" },
    ];

    const rows = computeItemPerformance(items);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ menuItemId: "item-a", quantitySold: 2, netSalesMinor: 400n });
  });

  it("sums quantities and subtotals for the same menuItemId across multiple completed orders", () => {
    const items: ItemSaleRow[] = [
      { menuItemId: "item-a", quantity: 2, subtotalMinor: 400n, orderStatus: "COMPLETED" },
      { menuItemId: "item-a", quantity: 3, subtotalMinor: 600n, orderStatus: "COMPLETED" },
      { menuItemId: "item-b", quantity: 1, subtotalMinor: 100n, orderStatus: "COMPLETED" },
      { menuItemId: "item-a", quantity: 99, subtotalMinor: 9999n, orderStatus: "CANCELLED" },
    ];

    const rows = computeItemPerformance(items);

    const itemA = rows.find((r) => r.menuItemId === "item-a");
    const itemB = rows.find((r) => r.menuItemId === "item-b");

    expect(itemA).toEqual({ menuItemId: "item-a", quantitySold: 5, netSalesMinor: 1000n });
    expect(itemB).toEqual({ menuItemId: "item-b", quantitySold: 1, netSalesMinor: 100n });
    expect(rows).toHaveLength(2);
  });
});

describe("computePaymentBreakdown", () => {
  const outletId = "outlet-1";
  const range = { fromDate: new Date("2026-01-01"), toDate: new Date("2026-01-31") };

  it("only counts CAPTURED payments toward totals and per-method aggregates", () => {
    const payments: PaymentAggregateRow[] = [
      { method: "CASH", status: "CAPTURED", amountMinor: 1000n },
      { method: "CARD", status: "CAPTURED", amountMinor: 2000n },
      { method: "CASH", status: "REFUNDED", amountMinor: 500n },
      { method: "UPI", status: "FAILED", amountMinor: 700n },
    ];

    const breakdown = computePaymentBreakdown(outletId, range, payments);

    expect(breakdown.totalAmountMinor).toBe(3000n);
    expect(breakdown.methods).toHaveLength(2);
    const cash = breakdown.methods.find((m) => m.method === "CASH");
    const card = breakdown.methods.find((m) => m.method === "CARD");
    expect(cash).toEqual({ method: "CASH", amountMinor: 1000n, count: 1, percentage: (1000 / 3000) * 100 });
    expect(card).toEqual({ method: "CARD", amountMinor: 2000n, count: 1, percentage: (2000 / 3000) * 100 });
  });

  it("sums amounts and counts across multiple payments with the same method", () => {
    const payments: PaymentAggregateRow[] = [
      { method: "CASH", status: "CAPTURED", amountMinor: 1000n },
      { method: "CASH", status: "CAPTURED", amountMinor: 500n },
    ];

    const breakdown = computePaymentBreakdown(outletId, range, payments);

    expect(breakdown.methods).toEqual([{ method: "CASH", amountMinor: 1500n, count: 2, percentage: 100 }]);
  });

  it("returns zero totals and empty methods with no CAPTURED payments, no throw", () => {
    const payments: PaymentAggregateRow[] = [
      { method: "CASH", status: "REFUNDED", amountMinor: 500n },
      { method: "UPI", status: "FAILED", amountMinor: 700n },
    ];

    expect(() => computePaymentBreakdown(outletId, range, payments)).not.toThrow();
    const breakdown = computePaymentBreakdown(outletId, range, payments);
    expect(breakdown.totalAmountMinor).toBe(0n);
    expect(breakdown.methods).toHaveLength(0);
  });

  it("includes formulaVersion matching KPI_FORMULA_VERSION", () => {
    const payments: PaymentAggregateRow[] = [{ method: "CASH", status: "CAPTURED", amountMinor: 1000n }];
    const breakdown = computePaymentBreakdown(outletId, range, payments);
    expect(breakdown.formulaVersion).toBe(KPI_FORMULA_VERSION);
  });
});

describe("computeChannelBreakdown", () => {
  const outletId = "outlet-1";
  const range = { fromDate: new Date("2026-01-01"), toDate: new Date("2026-01-31") };

  it("groups orders by orderType, counting all statuses toward orderCount", () => {
    const orders: ChannelOrderRow[] = [
      { orderType: "DINE_IN", status: "COMPLETED", grandTotalMinor: 1000n },
      { orderType: "DINE_IN", status: "CANCELLED", grandTotalMinor: 500n },
      { orderType: "PICKUP", status: "COMPLETED", grandTotalMinor: 300n },
      { orderType: "DELIVERY", status: "DRAFT", grandTotalMinor: 200n },
    ];

    const breakdown = computeChannelBreakdown(outletId, range, orders);

    expect(breakdown.totalOrderCount).toBe(4);
    const dineIn = breakdown.channels.find((c) => c.orderType === "DINE_IN");
    expect(dineIn).toEqual({
      orderType: "DINE_IN",
      orderCount: 2,
      successfulOrderCount: 1,
      cancelledOrderCount: 1,
      netSalesMinor: 1000n,
    });
  });

  it("only counts COMPLETED orders toward netSalesMinor and successfulOrderCount", () => {
    const orders: ChannelOrderRow[] = [
      { orderType: "PICKUP", status: "COMPLETED", grandTotalMinor: 1000n },
      { orderType: "PICKUP", status: "COMPLETED", grandTotalMinor: 500n },
      { orderType: "PICKUP", status: "FAILED", grandTotalMinor: 9999n },
    ];

    const breakdown = computeChannelBreakdown(outletId, range, orders);

    const pickup = breakdown.channels.find((c) => c.orderType === "PICKUP");
    expect(pickup?.netSalesMinor).toBe(1500n);
    expect(pickup?.successfulOrderCount).toBe(2);
    expect(pickup?.orderCount).toBe(3);
  });

  it("aggregates total successful/cancelled counts across channels, empty channels with no orders", () => {
    const breakdown = computeChannelBreakdown(outletId, range, []);
    expect(breakdown.totalOrderCount).toBe(0);
    expect(breakdown.totalSuccessfulOrderCount).toBe(0);
    expect(breakdown.totalCancelledOrderCount).toBe(0);
    expect(breakdown.channels).toHaveLength(0);
  });

  it("includes formulaVersion matching KPI_FORMULA_VERSION", () => {
    const orders: ChannelOrderRow[] = [{ orderType: "DINE_IN", status: "COMPLETED", grandTotalMinor: 1000n }];
    const breakdown = computeChannelBreakdown(outletId, range, orders);
    expect(breakdown.formulaVersion).toBe(KPI_FORMULA_VERSION);
  });
});

describe("computeTableTurnaroundAverage", () => {
  const outletId = "outlet-1";
  const range = { fromDate: new Date("2026-01-01"), toDate: new Date("2026-01-31") };

  it("averages minutes between createdAt and settledAt across multiple qualifying orders", () => {
    const rows: DineInTurnaroundRow[] = [
      {
        orderId: "o1",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-05T10:00:00Z"),
        settledAt: new Date("2026-01-05T10:30:00Z"), // 30 min
      },
      {
        orderId: "o2",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-06T12:00:00Z"),
        settledAt: new Date("2026-01-06T12:50:00Z"), // 50 min
      },
    ];

    const result = computeTableTurnaroundAverage(outletId, range, rows);

    expect(result.qualifyingOrderCount).toBe(2);
    expect(result.averageMinutes).toBe(40);
  });

  it("excludes late-settled covers whose seat-to-settle span exceeds a service day", () => {
    const rows: DineInTurnaroundRow[] = [
      {
        orderId: "o1",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-05T10:00:00Z"),
        settledAt: new Date("2026-01-05T10:40:00Z"),
      },
      {
        orderId: "o2",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-05T10:00:00Z"),
        settledAt: new Date("2026-01-07T10:00:00Z"),
      },
    ];

    const result = computeTableTurnaroundAverage(outletId, range, rows);

    expect(result.qualifyingOrderCount).toBe(1);
    expect(result.averageMinutes).toBe(40);
  });

  it("excludes orders with no settled status (settledAt null)", () => {
    const rows: DineInTurnaroundRow[] = [
      {
        orderId: "o1",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-05T10:00:00Z"),
        settledAt: new Date("2026-01-05T10:20:00Z"), // 20 min
      },
      {
        orderId: "o2",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-06T12:00:00Z"),
        settledAt: null, // still open / never settled
      },
    ];

    const result = computeTableTurnaroundAverage(outletId, range, rows);

    expect(result.qualifyingOrderCount).toBe(1);
    expect(result.averageMinutes).toBe(20);
  });

  it("excludes non-DINE_IN orders", () => {
    const rows: DineInTurnaroundRow[] = [
      {
        orderId: "o1",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-05T10:00:00Z"),
        settledAt: new Date("2026-01-05T10:10:00Z"), // 10 min
      },
      {
        orderId: "o2",
        orderType: "PICKUP",
        createdAt: new Date("2026-01-06T12:00:00Z"),
        settledAt: new Date("2026-01-06T13:00:00Z"), // 60 min, should be excluded
      },
    ];

    const result = computeTableTurnaroundAverage(outletId, range, rows);

    expect(result.qualifyingOrderCount).toBe(1);
    expect(result.averageMinutes).toBe(10);
  });

  it("returns 0 averageMinutes and 0 qualifyingOrderCount with no qualifying orders, no throw", () => {
    const rows: DineInTurnaroundRow[] = [
      { orderId: "o1", orderType: "DINE_IN", createdAt: new Date("2026-01-05T10:00:00Z"), settledAt: null },
      { orderId: "o2", orderType: "PICKUP", createdAt: new Date("2026-01-06T12:00:00Z"), settledAt: new Date("2026-01-06T12:30:00Z") },
    ];

    expect(() => computeTableTurnaroundAverage(outletId, range, rows)).not.toThrow();
    const result = computeTableTurnaroundAverage(outletId, range, rows);
    expect(result.qualifyingOrderCount).toBe(0);
    expect(result.averageMinutes).toBe(0);
  });

  it("includes formulaVersion matching KPI_FORMULA_VERSION", () => {
    const rows: DineInTurnaroundRow[] = [
      {
        orderId: "o1",
        orderType: "DINE_IN",
        createdAt: new Date("2026-01-05T10:00:00Z"),
        settledAt: new Date("2026-01-05T10:10:00Z"),
      },
    ];
    const result = computeTableTurnaroundAverage(outletId, range, rows);
    expect(result.formulaVersion).toBe(KPI_FORMULA_VERSION);
  });
});

describe("computeLeakageReport", () => {
  const outletId = "outlet-1";
  const range = { fromDate: new Date("2026-01-01"), toDate: new Date("2026-01-31") };

  it("tallies cancelled/modified/shifted counts and reasonCode breakdown from mixed rows", () => {
    const kotEvents: KotLeakageEventRow[] = [
      { status: "CANCELLED", reasonCode: "GUEST_LEFT" },
      { status: "CANCELLED", reasonCode: "GUEST_LEFT" },
      { status: "MODIFIED", reasonCode: "WRONG_ORDER" },
      { status: "SHIFTED", reasonCode: null },
    ];
    const invoices: InvoiceLeakageRow[] = [
      { reprintCount: 2, waivedOffMinor: 0n },
      { reprintCount: 0, waivedOffMinor: 500n },
      { reprintCount: 1, waivedOffMinor: 0n },
      { reprintCount: 0, waivedOffMinor: 0n },
    ];
    const unbilledKots: UnbilledKotRow[] = [
      { kotTicketId: "k1", orderGrandTotalMinor: 1200n },
      { kotTicketId: "k2", orderGrandTotalMinor: 800n },
    ];

    const report = computeLeakageReport(outletId, range, kotEvents, invoices, unbilledKots);

    expect(report.cancelledCount).toBe(2);
    expect(report.modifiedCount).toBe(1);
    expect(report.shiftedCount).toBe(1);
    expect(report.reasonCodeBreakdown).toEqual({ GUEST_LEFT: 2, WRONG_ORDER: 1, "": 1 });
    expect(report.invoiceReprintCount).toBe(2);
    expect(report.totalReprints).toBe(3);
    expect(report.invoiceWaivedOffCount).toBe(1);
    expect(report.totalWaivedOffMinor).toBe(500n);
    expect(report.kotsNotBilledCount).toBe(2);
    expect(report.estimatedRevenueAtRiskMinor).toBe(2000n);
    expect(report.formulaVersion).toBe(KPI_FORMULA_VERSION);
  });

  it("returns all-zero report with empty rows, no throw", () => {
    expect(() => computeLeakageReport(outletId, range, [], [], [])).not.toThrow();
    const report = computeLeakageReport(outletId, range, [], [], []);

    expect(report.cancelledCount).toBe(0);
    expect(report.modifiedCount).toBe(0);
    expect(report.shiftedCount).toBe(0);
    expect(report.reasonCodeBreakdown).toEqual({});
    expect(report.invoiceReprintCount).toBe(0);
    expect(report.totalReprints).toBe(0);
    expect(report.invoiceWaivedOffCount).toBe(0);
    expect(report.totalWaivedOffMinor).toBe(0n);
    expect(report.kotsNotBilledCount).toBe(0);
    expect(report.estimatedRevenueAtRiskMinor).toBe(0n);
  });

  it("sums estimatedRevenueAtRiskMinor from unbilled KOTs' parent order grandTotal", () => {
    const unbilledKots: UnbilledKotRow[] = [
      { kotTicketId: "k1", orderGrandTotalMinor: 350n },
      { kotTicketId: "k2", orderGrandTotalMinor: 150n },
      { kotTicketId: "k3", orderGrandTotalMinor: 999n },
    ];

    const report = computeLeakageReport(outletId, range, [], [], unbilledKots);

    expect(report.kotsNotBilledCount).toBe(3);
    expect(report.estimatedRevenueAtRiskMinor).toBe(1499n);
  });

  it("includes formulaVersion matching KPI_FORMULA_VERSION", () => {
    const report = computeLeakageReport(outletId, range, [], [], []);
    expect(report.formulaVersion).toBe(KPI_FORMULA_VERSION);
  });
});
