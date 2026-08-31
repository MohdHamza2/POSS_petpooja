// Contract for services/reporting. DEC-009 (approved, Option D): minimal
// signed KPI set for R1, one shared calculation layer, versioned formula
// catalogue, derived from order-level detail — never pre-aggregated tables
// that could drift from the transactional source of truth.

export interface DateRange {
  fromDate: Date;
  toDate: Date;
}

// Every KPI in this catalogue has a version. When a formula changes, bump
// the version rather than silently changing the number a past report showed.
export const KPI_FORMULA_VERSION = 1;

export interface SalesSummary {
  outletId: string;
  fromDate: Date;
  toDate: Date;
  formulaVersion: number;
  orderCount: number; // COMPLETED orders only — see formula note in reporting-service.ts
  netSalesMinor: bigint; // grandTotal sum, excludes CANCELLED/FAILED orders
  averageOrderValueMinor: bigint; // netSalesMinor / orderCount, 0 if orderCount is 0
}

export interface ItemPerformanceRow {
  menuItemId: string;
  quantitySold: number;
  netSalesMinor: bigint;
}

export interface PaymentMethodBreakdownRow {
  method: string; // raw Payment.method value, e.g. CASH, CARD, UPI, SPLIT
  amountMinor: bigint; // sum of CAPTURED payment amounts for this method
  count: number; // number of CAPTURED payments for this method
  percentage: number; // share of totalAmountMinor, 0-100, 0 if total is 0
}

export interface PaymentBreakdown {
  outletId: string;
  fromDate: Date;
  toDate: Date;
  formulaVersion: number;
  totalAmountMinor: bigint; // sum across all CAPTURED payments in range
  methods: PaymentMethodBreakdownRow[];
}

export interface ChannelBreakdownRow {
  orderType: string; // raw Order.orderType value, e.g. DINE_IN, TAKEAWAY, DELIVERY, AGGREGATOR
  orderCount: number; // all orders of this type in range (any status)
  successfulOrderCount: number; // COMPLETED orders of this type
  cancelledOrderCount: number; // CANCELLED orders of this type
  netSalesMinor: bigint; // grandTotal sum of COMPLETED orders of this type
}

export interface ChannelBreakdown {
  outletId: string;
  fromDate: Date;
  toDate: Date;
  formulaVersion: number;
  channels: ChannelBreakdownRow[];
  totalOrderCount: number;
  totalSuccessfulOrderCount: number;
  totalCancelledOrderCount: number;
}

// Table Turnaround Average (T.T.A) — for DINE_IN orders with a diningTableId,
// the average minutes from Order.createdAt (seat/KOT start) to settledAt
// (clear-time). Covers with no settledAt are excluded. Covers whose span
// exceeds 12 hours are treated as late-settled leakage, not table turns.
export interface TableTurnaroundAverage {
  outletId: string;
  fromDate: Date;
  toDate: Date;
  formulaVersion: number;
  averageMinutes: number; // 0 if no qualifying orders
  qualifyingOrderCount: number;
}

// Leakage Report — Phase B anomaly/loss-detection tracking of KOT
// cancellations/modifications/station-shifts and bill reprints/waive-offs.
// kotsNotBilledCount/estimatedRevenueAtRiskMinor: KOTs in range whose parent
// order has zero linked Invoice rows — revenue at risk is estimated from the
// parent Order's grandTotal (the accurately-derivable figure via existing
// Prisma relations; a KOT has no price of its own, only its parent order does).
export interface LeakageReport {
  outletId: string;
  fromDate: Date;
  toDate: Date;
  formulaVersion: number;
  cancelledCount: number;
  modifiedCount: number;
  shiftedCount: number;
  reasonCodeBreakdown: Record<string, number>; // reasonCode -> count, across CANCELLED/MODIFIED/SHIFTED rows ("" for null/missing reasonCode)
  invoiceReprintCount: number; // count of invoices with reprintCount > 0
  totalReprints: number; // sum of reprintCount across all invoices
  invoiceWaivedOffCount: number; // count of invoices with waivedOffMinor > 0
  totalWaivedOffMinor?: bigint;
  kotsNotBilledCount: number;
  estimatedRevenueAtRiskMinor: bigint;
}

export interface TaxComponentBreakdown {
  componentName: string; // e.g. "CGST", "SGST", "IGST"
  ratePercent: number; // e.g. 2.5
  taxableAmountMinor: bigint; // net taxable sales basis
  taxCollectedMinor: bigint; // tax amount in minor units
  percentageShare: number; // percentage of total tax collected (0-100)
}

export interface TaxBreakdown {
  outletId: string;
  fromDate: Date;
  toDate: Date;
  formulaVersion: number;
  totalTaxableSalesMinor: bigint;
  totalTaxCollectedMinor: bigint;
  effectiveTaxRatePercent: number;
  orderCount: number;
  components: TaxComponentBreakdown[];
}

