import { KPI_FORMULA_VERSION } from "@kapmeta/shared-types/reporting";
import type {
  DateRange,
  SalesSummary,
  ItemPerformanceRow,
  PaymentBreakdown,
  PaymentMethodBreakdownRow,
  ChannelBreakdown,
  ChannelBreakdownRow,
  TableTurnaroundAverage,
  LeakageReport,
  TaxBreakdown,
  TaxComponentBreakdown,
} from "@kapmeta/shared-types/reporting";
import type { OrderStatus } from "@kapmeta/shared-types/orders";

export interface TaxOrderRow {
  subtotalMinor: bigint;
  taxTotalMinor: bigint;
  grandTotalMinor: bigint;
  orderType: string;
}

export interface OrderAggregateRow {
  status: OrderStatus;
  grandTotalMinor: bigint;
}

export interface ItemSaleRow {
  menuItemId: string;
  quantity: number;
  subtotalMinor: bigint;
  orderStatus: OrderStatus;
}

export interface PaymentAggregateRow {
  method: string;
  status: string; // CAPTURED, REFUNDED, FAILED
  amountMinor: bigint;
}

export interface ChannelOrderRow {
  orderType: string;
  status: OrderStatus;
  grandTotalMinor: bigint;
}

// One row per DINE_IN order that has a diningTableId in range. settledAt is
// null when the order has no SETTLED row in OrderStatusHistory (table never
// cleared, or still in progress) — such orders are excluded from the average.
export interface DineInTurnaroundRow {
  orderId: string;
  orderType: string;
  createdAt: Date;
  settledAt: Date | null;
}

// One row per CANCELLED/MODIFIED/SHIFTED KOTStatusHistory entry in range.
export interface KotLeakageEventRow {
  status: string; // CANCELLED | MODIFIED | SHIFTED
  reasonCode: string | null;
}

// One row per Invoice in range (reprint/waive-off leakage figures).
export interface InvoiceLeakageRow {
  reprintCount: number;
  waivedOffMinor: bigint;
}

// One row per KOT ticket in range whose parent order has zero linked
// Invoice rows — i.e. served/in-progress work with no bill raised against it.
export interface UnbilledKotRow {
  kotTicketId: string;
  orderGrandTotalMinor: bigint;
}

export interface ReportingRepository {
  listOrdersInRange(outletId: string, range: DateRange): Promise<OrderAggregateRow[]>;
  listOrderItemsInRange(outletId: string, range: DateRange): Promise<ItemSaleRow[]>;
  listPaymentsInRange(outletId: string, range: DateRange): Promise<PaymentAggregateRow[]>;
  listChannelOrdersInRange(outletId: string, range: DateRange): Promise<ChannelOrderRow[]>;
  listDineInTurnaroundRowsInRange(outletId: string, range: DateRange): Promise<DineInTurnaroundRow[]>;
  listKotStatusEventsInRange(outletId: string, range: DateRange): Promise<KotLeakageEventRow[]>;
  listInvoiceLeakageInRange(outletId: string, range: DateRange): Promise<InvoiceLeakageRow[]>;
  listKotsNotBilledInRange(outletId: string, range: DateRange): Promise<UnbilledKotRow[]>;
  listTaxOrdersInRange(outletId: string, range: DateRange): Promise<TaxOrderRow[]>;
}

export function computeSalesSummary(
  outletId: string,
  range: DateRange,
  orders: OrderAggregateRow[]
): SalesSummary {
  const completed = orders.filter((order) => order.status === "COMPLETED");
  const orderCount = completed.length;
  const netSalesMinor = completed.reduce((sum, order) => sum + order.grandTotalMinor, 0n);
  const averageOrderValueMinor = orderCount === 0 ? 0n : netSalesMinor / BigInt(orderCount);

  return {
    outletId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    formulaVersion: KPI_FORMULA_VERSION,
    orderCount,
    netSalesMinor,
    averageOrderValueMinor,
  };
}

export function computeItemPerformance(items: ItemSaleRow[]): ItemPerformanceRow[] {
  const completed = items.filter((item) => item.orderStatus === "COMPLETED");
  const byItem = new Map<string, ItemPerformanceRow>();

  for (const item of completed) {
    const existing = byItem.get(item.menuItemId);
    if (existing) {
      existing.quantitySold += item.quantity;
      existing.netSalesMinor += item.subtotalMinor;
    } else {
      byItem.set(item.menuItemId, {
        menuItemId: item.menuItemId,
        quantitySold: item.quantity,
        netSalesMinor: item.subtotalMinor,
      });
    }
  }

  return Array.from(byItem.values());
}

export async function getSalesSummary(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<SalesSummary> {
  const orders = await repo.listOrdersInRange(outletId, range);
  return computeSalesSummary(outletId, range, orders);
}

export async function getItemPerformance(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<ItemPerformanceRow[]> {
  const items = await repo.listOrderItemsInRange(outletId, range);
  return computeItemPerformance(items);
}

// Only CAPTURED payments count toward totals — REFUNDED/FAILED payments never
// represent settled cash actually received.
export function computePaymentBreakdown(
  outletId: string,
  range: DateRange,
  payments: PaymentAggregateRow[]
): PaymentBreakdown {
  const captured = payments.filter((p) => p.status === "CAPTURED");
  const totalAmountMinor = captured.reduce((sum, p) => sum + p.amountMinor, 0n);

  const byMethod = new Map<string, { amountMinor: bigint; count: number }>();
  for (const p of captured) {
    const existing = byMethod.get(p.method);
    if (existing) {
      existing.amountMinor += p.amountMinor;
      existing.count += 1;
    } else {
      byMethod.set(p.method, { amountMinor: p.amountMinor, count: 1 });
    }
  }

  const totalNumber = Number(totalAmountMinor);
  const methods: PaymentMethodBreakdownRow[] = Array.from(byMethod.entries()).map(([method, agg]) => ({
    method,
    amountMinor: agg.amountMinor,
    count: agg.count,
    percentage: totalNumber === 0 ? 0 : (Number(agg.amountMinor) / totalNumber) * 100,
  }));

  return {
    outletId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    formulaVersion: KPI_FORMULA_VERSION,
    totalAmountMinor,
    methods,
  };
}

export async function getPaymentBreakdown(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<PaymentBreakdown> {
  const payments = await repo.listPaymentsInRange(outletId, range);
  return computePaymentBreakdown(outletId, range, payments);
}

// Channel breakdown by orderType (DINE_IN/TAKEAWAY/DELIVERY/AGGREGATOR). orderCount
// includes orders of every status; netSalesMinor and successfulOrderCount
// only reflect COMPLETED orders (matches computeSalesSummary formula).
export function computeChannelBreakdown(
  outletId: string,
  range: DateRange,
  orders: ChannelOrderRow[]
): ChannelBreakdown {
  const byType = new Map<string, ChannelBreakdownRow>();

  for (const order of orders) {
    let row = byType.get(order.orderType);
    if (!row) {
      row = {
        orderType: order.orderType,
        orderCount: 0,
        successfulOrderCount: 0,
        cancelledOrderCount: 0,
        netSalesMinor: 0n,
      };
      byType.set(order.orderType, row);
    }
    row.orderCount += 1;
    if (order.status === "COMPLETED") {
      row.successfulOrderCount += 1;
      row.netSalesMinor += order.grandTotalMinor;
    } else if (order.status === "CANCELLED") {
      row.cancelledOrderCount += 1;
    }
  }

  const channels = Array.from(byType.values());
  const totalOrderCount = orders.length;
  const totalSuccessfulOrderCount = channels.reduce((sum, c) => sum + c.successfulOrderCount, 0);
  const totalCancelledOrderCount = channels.reduce((sum, c) => sum + c.cancelledOrderCount, 0);

  return {
    outletId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    formulaVersion: KPI_FORMULA_VERSION,
    channels,
    totalOrderCount,
    totalSuccessfulOrderCount,
    totalCancelledOrderCount,
  };
}

export async function getChannelBreakdown(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<ChannelBreakdown> {
  const orders = await repo.listChannelOrdersInRange(outletId, range);
  return computeChannelBreakdown(outletId, range, orders);
}

// Table Turnaround Average (T.T.A) — see TableTurnaroundAverage doc comment
// in shared-types/reporting.ts for the formula. Rows with settledAt === null
// (no SETTLED status recorded yet) are excluded from the average.
export function computeTableTurnaroundAverage(
  outletId: string,
  range: DateRange,
  rows: DineInTurnaroundRow[]
): TableTurnaroundAverage {
  const qualifying = rows.filter((r) => {
    if (r.orderType !== "DINE_IN" || r.settledAt === null) return false;
    const minutes = (r.settledAt.getTime() - r.createdAt.getTime()) / 60000;
    // Late-settled abandoned covers (created days before settle) are leakage, not table turns.
    return minutes >= 0 && minutes <= 12 * 60;
  });
  const qualifyingOrderCount = qualifying.length;

  const totalMinutes = qualifying.reduce((sum, r) => {
    const minutes = (r.settledAt!.getTime() - r.createdAt.getTime()) / 60000;
    return sum + minutes;
  }, 0);

  const averageMinutes = qualifyingOrderCount === 0 ? 0 : totalMinutes / qualifyingOrderCount;

  return {
    outletId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    formulaVersion: KPI_FORMULA_VERSION,
    averageMinutes,
    qualifyingOrderCount,
  };
}

export async function getTableTurnaroundAverage(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<TableTurnaroundAverage> {
  const rows = await repo.listDineInTurnaroundRowsInRange(outletId, range);
  return computeTableTurnaroundAverage(outletId, range, rows);
}

// Leakage Report (Phase B) — combines KOT status-history events (CANCELLED/
// MODIFIED/SHIFTED), invoice reprint/waive-off figures, and KOTs with no
// linked invoice into a single anomaly/loss-detection view.
export function computeLeakageReport(
  outletId: string,
  range: DateRange,
  kotEvents: KotLeakageEventRow[],
  invoices: InvoiceLeakageRow[],
  unbilledKots: UnbilledKotRow[]
): LeakageReport {
  let cancelledCount = 0;
  let modifiedCount = 0;
  let shiftedCount = 0;
  const reasonCodeBreakdown: Record<string, number> = {};

  for (const event of kotEvents) {
    if (event.status === "CANCELLED") cancelledCount += 1;
    else if (event.status === "MODIFIED") modifiedCount += 1;
    else if (event.status === "SHIFTED") shiftedCount += 1;

    const key = event.reasonCode ?? "";
    reasonCodeBreakdown[key] = (reasonCodeBreakdown[key] ?? 0) + 1;
  }

  const reprintedInvoices = invoices.filter((inv) => inv.reprintCount > 0);
  const invoiceReprintCount = reprintedInvoices.length;
  const totalReprints = invoices.reduce((sum, inv) => sum + inv.reprintCount, 0);

  const waivedOffInvoices = invoices.filter((inv) => inv.waivedOffMinor > 0n);
  const invoiceWaivedOffCount = waivedOffInvoices.length;
  const totalWaivedOffMinor = invoices.reduce((sum, inv) => sum + inv.waivedOffMinor, 0n);

  const kotsNotBilledCount = unbilledKots.length;
  const estimatedRevenueAtRiskMinor = unbilledKots.reduce((sum, k) => sum + k.orderGrandTotalMinor, 0n);

  return {
    outletId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    formulaVersion: KPI_FORMULA_VERSION,
    cancelledCount,
    modifiedCount,
    shiftedCount,
    reasonCodeBreakdown,
    invoiceReprintCount,
    totalReprints,
    invoiceWaivedOffCount,
    totalWaivedOffMinor,
    kotsNotBilledCount,
    estimatedRevenueAtRiskMinor,
  };
}

export async function getLeakageReport(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<LeakageReport> {
  const [kotEvents, invoices, unbilledKots] = await Promise.all([
    repo.listKotStatusEventsInRange(outletId, range),
    repo.listInvoiceLeakageInRange(outletId, range),
    repo.listKotsNotBilledInRange(outletId, range),
  ]);
  return computeLeakageReport(outletId, range, kotEvents, invoices, unbilledKots);
}

export function computeTaxBreakdown(
  outletId: string,
  range: DateRange,
  orders: TaxOrderRow[]
): TaxBreakdown {
  const orderCount = orders.length;
  const totalTaxableSalesMinor = orders.reduce((sum, o) => sum + o.subtotalMinor, 0n);
  const totalTaxCollectedMinor = orders.reduce((sum, o) => sum + o.taxTotalMinor, 0n);

  const halfTax = totalTaxCollectedMinor / 2n;
  const otherHalf = totalTaxCollectedMinor - halfTax;

  const cgstCollected = halfTax;
  const sgstCollected = otherHalf;
  const igstCollected = 0n;

  const totalNum = Number(totalTaxCollectedMinor);
  const cgstShare = totalNum > 0 ? (Number(cgstCollected) / totalNum) * 100 : 50;
  const sgstShare = totalNum > 0 ? (Number(sgstCollected) / totalNum) * 100 : 50;

  const components: TaxComponentBreakdown[] = [
    {
      componentName: "CGST",
      ratePercent: 2.5,
      taxableAmountMinor: totalTaxableSalesMinor,
      taxCollectedMinor: cgstCollected,
      percentageShare: cgstShare,
    },
    {
      componentName: "SGST",
      ratePercent: 2.5,
      taxableAmountMinor: totalTaxableSalesMinor,
      taxCollectedMinor: sgstCollected,
      percentageShare: sgstShare,
    },
    {
      componentName: "IGST",
      ratePercent: 5.0,
      taxableAmountMinor: 0n,
      taxCollectedMinor: igstCollected,
      percentageShare: 0,
    },
  ];

  const taxableNum = Number(totalTaxableSalesMinor);
  const effectiveTaxRatePercent = taxableNum > 0 ? (totalNum / taxableNum) * 100 : 5.0;

  return {
    outletId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    formulaVersion: KPI_FORMULA_VERSION,
    totalTaxableSalesMinor,
    totalTaxCollectedMinor,
    effectiveTaxRatePercent: Number(effectiveTaxRatePercent.toFixed(2)),
    orderCount,
    components,
  };
}

export async function getTaxBreakdown(
  outletId: string,
  range: DateRange,
  repo: ReportingRepository
): Promise<TaxBreakdown> {
  const orders = await repo.listTaxOrdersInRange(outletId, range);
  return computeTaxBreakdown(outletId, range, orders);
}

