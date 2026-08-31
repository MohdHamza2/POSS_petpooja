import { PrismaClient } from "@prisma/client";

function businessDayWindow(dayStartTime: Date | null | undefined, date: Date): { start: Date; end: Date } {
  const hours = dayStartTime instanceof Date ? dayStartTime.getHours() : 5;
  const minutes = dayStartTime instanceof Date ? dayStartTime.getMinutes() : 0;
  const start = new Date(date);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export class ZReportGenerator {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  async generateDailyReport(outletId: string, date: Date) {
    const outlet = await this.prisma.outlet.findUnique({ where: { id: outletId } });
    const { start, end } = businessDayWindow(outlet?.dayStartTime ?? null, date);

    const orders = await this.prisma.order.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        OR: [
          { settledAt: { gte: start, lt: end } },
          { AND: [{ settledAt: null }, { createdAt: { gte: start, lt: end } }] },
        ],
      },
    });

    const payments = await this.prisma.payment.findMany({
      where: {
        outletId,
        status: "CAPTURED",
        createdAt: {
          gte: start,
          lt: end,
        },
      },
    });

    let totalSales = 0n;
    let totalTax = 0n;
    let totalTips = 0n;
    let totalServiceCharge = 0n;
    const paymentModes: Record<string, bigint> = {};

    for (const ord of orders) {
      totalSales += ord.grandTotal;
      totalTax += ord.taxTotal || 0n;
      totalTips += ord.tipTotal || 0n;
      totalServiceCharge += ord.serviceChargeTotal || 0n;
    }

    for (const p of payments) {
      if (!paymentModes[p.method]) {
        paymentModes[p.method] = 0n;
      }
      paymentModes[p.method] += p.amount;
    }

    const handovers = await this.prisma.waiterShiftHandover.findMany({
      where: {
        outletId,
        createdAt: { gte: start, lt: end },
      },
    });
    let handoverCashCounted = 0n;
    let handoverTipPayout = 0n;
    let handoverDigitalTips = 0n;
    for (const h of handovers) {
      handoverCashCounted += h.actualCashCountedMinor;
      handoverTipPayout += h.netTipPayoutMinor;
      handoverDigitalTips += h.digitalTipsMinor;
    }


    return {
      outletId,
      date: start.toISOString().split("T")[0],
      businessDayStart: start.toISOString(),
      businessDayEnd: end.toISOString(),
      totalSales,
      totalTax,
      grandTotal: totalSales,
      totalTips,
      totalServiceCharge,
      paymentModes,
      invoiceCount: orders.length === 0
        ? 0
        : await this.prisma.invoice.count({ where: { orderId: { in: orders.map((o) => o.id) } } }),
      handoverCount: handovers.length,
      handoverCashCounted,
      handoverTipPayout,
      handoverDigitalTips,
    };
  }
}
