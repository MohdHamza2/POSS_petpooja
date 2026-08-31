import { PrismaClient } from "@prisma/client";
import type {
  ReportingRepository,
  OrderAggregateRow,
  ItemSaleRow,
  PaymentAggregateRow,
  ChannelOrderRow,
  DineInTurnaroundRow,
  KotLeakageEventRow,
  InvoiceLeakageRow,
  UnbilledKotRow,
  TaxOrderRow,
} from "../reporting-service";
import type { DateRange } from "@kapmeta/shared-types/reporting";
import type { OrderStatus } from "@kapmeta/shared-types/orders";

export class PrismaReportingRepository implements ReportingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listOrdersInRange(outletId: string, range: DateRange): Promise<OrderAggregateRow[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        OR: [
          { settledAt: { gte: range.fromDate, lte: range.toDate } },
          { AND: [{ settledAt: null }, { createdAt: { gte: range.fromDate, lte: range.toDate } }] },
        ],
      },
      select: { status: true, grandTotal: true },
    });

    return rows.map((row) => ({
      status: row.status as OrderStatus,
      grandTotalMinor: row.grandTotal,
    }));
  }

  async listOrderItemsInRange(outletId: string, range: DateRange): Promise<ItemSaleRow[]> {
    const rows = await this.prisma.orderItem.findMany({
      where: { outletId, order: { status: "COMPLETED", OR: [
        { settledAt: { gte: range.fromDate, lte: range.toDate } },
        { AND: [{ settledAt: null }, { createdAt: { gte: range.fromDate, lte: range.toDate } }] },
      ] } },
      select: {
        menuItemId: true,
        quantity: true,
        subtotal: true,
        order: { select: { status: true } },
      },
    });

    return rows.map((row) => ({
      menuItemId: row.menuItemId,
      quantity: Number(row.quantity),
      subtotalMinor: row.subtotal,
      orderStatus: row.order.status as OrderStatus,
    }));
  }

  async listPaymentsInRange(outletId: string, range: DateRange): Promise<PaymentAggregateRow[]> {
    // Payment has no Prisma relation to Order (only orderId). Match sales/tax
    // settle-time window via order ids — payment.createdAt pulled prior-day
    // session cash into the Day KPI.
    const settled = await this.prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        OR: [
          { settledAt: { gte: range.fromDate, lte: range.toDate } },
          { AND: [{ settledAt: null }, { createdAt: { gte: range.fromDate, lte: range.toDate } }] },
        ],
      },
      select: { id: true },
    });
    const orderIds = settled.map((o) => o.id);
    if (orderIds.length === 0) return [];
    const rows = await this.prisma.payment.findMany({
      where: { outletId, orderId: { in: orderIds } },
      select: { method: true, status: true, amount: true },
    });

    return rows.map((row) => ({
      method: row.method,
      status: row.status,
      amountMinor: row.amount,
    }));
  }

  async listChannelOrdersInRange(outletId: string, range: DateRange): Promise<ChannelOrderRow[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        outletId,
        status: { in: ["COMPLETED", "CANCELLED"] },
        OR: [
          { settledAt: { gte: range.fromDate, lte: range.toDate } },
          { AND: [{ settledAt: null }, { createdAt: { gte: range.fromDate, lte: range.toDate } }] },
        ],
      },
      select: { orderType: true, status: true, grandTotal: true },
    });

    return rows.map((row) => ({
      orderType: row.orderType,
      status: row.status as OrderStatus,
      grandTotalMinor: row.grandTotal,
    }));
  }

  // Single query: DINE_IN orders with a table assigned
  async listDineInTurnaroundRowsInRange(outletId: string, range: DateRange): Promise<DineInTurnaroundRow[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        outletId,
        orderType: "DINE_IN",
        diningTableId: { not: null },
        OR: [
          { settledAt: { gte: range.fromDate, lte: range.toDate } },
          { AND: [{ settledAt: null }, { createdAt: { gte: range.fromDate, lte: range.toDate } }] },
        ],
      },
      select: {
        id: true,
        orderType: true,
        createdAt: true,
        settledAt: true,
      },
    });

    return rows.map((row) => ({
      orderId: row.id,
      orderType: row.orderType,
      createdAt: row.createdAt,
      settledAt: row.settledAt,
    }));
  }

  // CANCELLED/MODIFIED/SHIFTED KOTStatusHistory rows, scoped to this outlet's
  // KOT tickets and to history rows created within range.
  async listKotStatusEventsInRange(outletId: string, range: DateRange): Promise<KotLeakageEventRow[]> {
    const rows = await this.prisma.kOTStatusHistory.findMany({
      where: {
        status: { in: ["CANCELLED", "MODIFIED", "SHIFTED"] },
        createdAt: { gte: range.fromDate, lte: range.toDate },
        kotTicket: { outletId },
      },
      select: { status: true, reasonCode: true },
    });

    return rows.map((row) => ({
      status: row.status,
      reasonCode: row.reasonCode,
    }));
  }

  // Invoice-level reprint/waive-off figures for invoices created in range.
  async listInvoiceLeakageInRange(outletId: string, range: DateRange): Promise<InvoiceLeakageRow[]> {
    const rows = await this.prisma.invoice.findMany({
      where: {
        outletId,
        createdAt: { gte: range.fromDate, lte: range.toDate },
        OR: [
          { reprintCount: { gt: 0 } },
          { waivedOffMinor: { gt: 0 } },
        ],
      },
      select: { reprintCount: true, waivedOffMinor: true },
    });
    return rows.map((row) => ({
      reprintCount: row.reprintCount,
      waivedOffMinor: row.waivedOffMinor,
    }));
  }

  // KOT tickets in range whose parent order has zero linked Invoice rows —
  // revenue-at-risk is estimated from the parent Order's grandTotal
  async listKotsNotBilledInRange(outletId: string, range: DateRange): Promise<UnbilledKotRow[]> {
    const kots = await this.prisma.kOTTicket.findMany({
      where: {
        outletId,
        createdAt: { gte: range.fromDate, lte: range.toDate },
        status: { not: "CANCELLED" },
      },
      select: { id: true, orderId: true, status: true },
    });
    if (kots.length === 0) return [];

    const orderIds = Array.from(new Set(kots.map((k) => k.orderId)));
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, grandTotal: true, status: true },
    });
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const billed = await this.prisma.invoice.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true },
    });
    const billedIds = new Set(billed.map((i) => i.orderId));
    const settledOrDead = new Set(
      orders
        .filter((o) => o.status === "COMPLETED" || o.status === "CANCELLED" || o.status === "FAILED")
        .map((o) => o.id)
    );

    const result: UnbilledKotRow[] = [];
    for (const kot of kots) {
      if (billedIds.has(kot.orderId) || settledOrDead.has(kot.orderId)) continue;
      const order = orderById.get(kot.orderId);
      if (order) {
        result.push({
          kotTicketId: kot.id,
          orderGrandTotalMinor: order.grandTotal,
        });
      }
    }
    return result;
  }

  async listTaxOrdersInRange(outletId: string, range: DateRange): Promise<TaxOrderRow[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        OR: [
          { settledAt: { gte: range.fromDate, lte: range.toDate } },
          { AND: [{ settledAt: null }, { createdAt: { gte: range.fromDate, lte: range.toDate } }] },
        ],
      },
      select: {
        subtotal: true,
        taxTotal: true,
        grandTotal: true,
        orderType: true,
      },
    });

    return rows.map((row) => {
      const tax = row.taxTotal ?? 0n;
      const exclusive = row.grandTotal - tax;
      return {
        subtotalMinor: exclusive >= 0n ? exclusive : (row.subtotal ?? 0n),
        taxTotalMinor: tax,
        grandTotalMinor: row.grandTotal,
        orderType: row.orderType,
      };
    });
  }
}

