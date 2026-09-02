import { PrismaClient } from "@prisma/client";
import { businessDayWindow, parseDayStartClock } from "./business-day";

export class ZReportGenerator {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  async generateDailyReport(outletId: string, date: Date | string) {
    const outlet = await this.prisma.outlet.findUnique({ where: { id: outletId } });
    const dayStartTime = outlet?.dayStartTime ?? null;
    const clock = parseDayStartClock(dayStartTime);
    const { start, end, businessDate } = businessDayWindow(dayStartTime, date);
    const hours = dayStartTime instanceof Date ? dayStartTime.getHours() : 5;
    const utcHours = dayStartTime instanceof Date ? dayStartTime.getUTCHours() : null;
    const minutes = dayStartTime instanceof Date ? dayStartTime.getMinutes() : 0;

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
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'Z2',location:'z-report.ts:generateDailyReport',message:'dayStart clock vs window',data:{parsedDate:date instanceof Date?date.toISOString():String(date),dayStartIso:dayStartTime instanceof Date?dayStartTime.toISOString():String(dayStartTime),localHours:hours,localMinutes:minutes,utcHours,hoursUsed:clock.hours,minutesUsed:clock.minutes,windowStart:start.toISOString(),windowEnd:end.toISOString(),businessDate,completedInWindow:orders.length,paymentsInWindow:payments.length,sampleSettled:orders.slice(0,5).map((o)=>({id:o.orderNumber||o.id,status:o.status,settledAt:o.settledAt?o.settledAt.toISOString():null,createdAt:o.createdAt.toISOString(),grand:o.grandTotal.toString()}))},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
    // #endregion

    let totalSales = 0n;
    let totalTax = 0n;
    let totalTips = 0n;
    let totalServiceCharge = 0n;
    let grandTotal = 0n;
    const paymentModes: Record<string, bigint> = {};

    for (const ord of orders) {
      const tax = ord.taxTotal || 0n;
      grandTotal += ord.grandTotal;
      totalSales += ord.grandTotal - tax;
      totalTax += tax;
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
      date: businessDate,
      businessDayStart: start.toISOString(),
      businessDayEnd: end.toISOString(),
      totalSales,
      totalTax,
      grandTotal,
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
