import { Router } from "express";
import { prisma } from "../prisma";
import {
  getSalesSummary,
  getItemPerformance,
  getPaymentBreakdown,
  getChannelBreakdown,
  getTableTurnaroundAverage,
  getLeakageReport,
  getTaxBreakdown,
  PrismaReportingRepository,
} from "@kapmeta/reporting";
import { getRevenueTrend, PrismaOrderRepository } from "@kapmeta/orders";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";

const router = Router();

function parseRange(req: AuthedRequest): { fromDate: Date; toDate: Date } {
  const fromDate = req.query.fromDate;
  const toDate = req.query.toDate;
  if (typeof fromDate === "string" && typeof toDate === "string") {
    return { fromDate: new Date(fromDate), toDate: new Date(toDate) };
  }
  // Default to current month range
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { fromDate: start, toDate: end };
}

router.get("/revenue-trend", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    const orderRepo = new PrismaOrderRepository(prisma);
    const points = await getRevenueTrend(req.auth!.outletId, range.fromDate, range.toDate, orderRepo);
    res.status(200).json(points);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/sales-summary", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const summary = await getSalesSummary(outletId, range, repo);
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'T3',location:'reporting.ts:GET /sales-summary',message:'day net from order grandTotal',data:{from:range.fromDate.toISOString(),to:range.toDate.toISOString(),net:String(summary.netSalesMinor),orderCount:summary.orderCount},timestamp:Date.now(),runId:'tax-fix'})}).catch(()=>{});
    // #endregion

    res.status(200).json({
      ...summary,
      netSalesMinor: String(summary.netSalesMinor),
      averageOrderValueMinor: String(summary.averageOrderValueMinor),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/tax-breakdown", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const taxBreakdown = await getTaxBreakdown(outletId, range, repo);
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'GST1',location:'reporting.ts:GET /tax-breakdown',message:'GST taxable vs collected',data:{from:range?.fromDate?.toISOString(),to:range?.toDate?.toISOString(),taxable:String(taxBreakdown.totalTaxableSalesMinor),tax:String(taxBreakdown.totalTaxCollectedMinor),orderCount:taxBreakdown.orderCount,effective:taxBreakdown.effectiveTaxRatePercent},timestamp:Date.now(),runId:'gst-post'})}).catch(()=>{});
    // #endregion

    res.status(200).json({
      ...taxBreakdown,
      totalTaxableSalesMinor: String(taxBreakdown.totalTaxableSalesMinor),
      totalTaxCollectedMinor: String(taxBreakdown.totalTaxCollectedMinor),
      components: taxBreakdown.components.map((c) => ({
        ...c,
        taxableAmountMinor: String(c.taxableAmountMinor),
        taxCollectedMinor: String(c.taxCollectedMinor),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/item-performance", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const rows = await getItemPerformance(outletId, range, repo);

    // Fetch names for all menu items
    const itemIds = rows.map((r) => r.menuItemId);
    const menuItems = itemIds.length > 0
      ? await prisma.menuItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const nameMap = new Map(menuItems.map((m) => [m.id, m.name]));

    res.status(200).json(
      rows.map((row) => ({
        ...row,
        menuItemName: nameMap.get(row.menuItemId) || `Dish (${row.menuItemId.slice(0, 6)})`,
        name: nameMap.get(row.menuItemId) || `Dish (${row.menuItemId.slice(0, 6)})`,
        netSalesMinor: String(row.netSalesMinor),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/payment-breakdown", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const breakdown = await getPaymentBreakdown(outletId, range, repo);
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'P1',location:'reporting.ts:GET /payment-breakdown',message:'payment breakdown settle-window',data:{from:range.fromDate.toISOString(),to:range.toDate.toISOString(),total:String(breakdown.totalAmountMinor),methods:breakdown.methods.map((m)=>({method:m.method,count:m.count,amount:String(m.amountMinor)}))},timestamp:Date.now(),runId:'pay-post'})}).catch(()=>{});
    // #endregion

    res.status(200).json({
      ...breakdown,
      totalAmountMinor: String(breakdown.totalAmountMinor),
      methods: breakdown.methods.map((m) => ({ ...m, amountMinor: String(m.amountMinor) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/channel-breakdown", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const breakdown = await getChannelBreakdown(outletId, range, repo);

    res.status(200).json({
      ...breakdown,
      channels: breakdown.channels.map((c) => ({ ...c, netSalesMinor: String(c.netSalesMinor) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/table-turnaround", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const tta = await getTableTurnaroundAverage(outletId, range, repo);
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'reporting.ts:GET /table-turnaround',message:'TTA average vs range',data:{from:range.fromDate.toISOString(),to:range.toDate.toISOString(),averageMinutes:tta.averageMinutes,qualifyingOrderCount:tta.qualifyingOrderCount},timestamp:Date.now(),runId:'tta-post'})}).catch(()=>{});
    // #endregion
    res.status(200).json(tta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/leakage-report", requireAuth, requirePermission("report.financial.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const outletId = req.auth!.outletId;

    const repo = new PrismaReportingRepository(prisma);
    const report = await getLeakageReport(outletId, range, repo);

    res.status(200).json({
      ...report,
      totalWaivedOffMinor: String(report.totalWaivedOffMinor),
      estimatedRevenueAtRiskMinor: String(report.estimatedRevenueAtRiskMinor),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

import { ExecutiveDashboard, ERPExportGenerator } from "@kapmeta/reporting";
const executiveDashboard = new ExecutiveDashboard(prisma);
const erpExportGenerator = new ERPExportGenerator(prisma);

router.get("/dashboard", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = parseRange(req);
    if (!range) {
      res.status(400).json({ error: "fromDate, toDate query params required" });
      return;
    }
    const dashboard = await executiveDashboard.getKPIDashboard(req.auth!.outletId, range.fromDate, range.toDate);
    res.status(200).json(dashboard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/tally-export", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const dateParam = req.query.date as string;
    const date = dateParam ? new Date(dateParam) : new Date();

    const tallyExport = await erpExportGenerator.generateTallyExport(req.auth!.outletId, date);
    res.status(200).json(tallyExport);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/invoices", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 500);
    const fromDate = req.query.fromDate ? new Date(String(req.query.fromDate)) : undefined;
    const toDate = req.query.toDate ? new Date(String(req.query.toDate)) : undefined;

    const where: any = {
      outletId,
      status: "COMPLETED",
    };

    if (fromDate || toDate) {
      where.OR = [
        { settledAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } },
        { AND: [{ settledAt: null }, { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }] },
      ];
    }

    const dbInvoices = await prisma.invoice.findMany({
      where: {
        outletId,
        order: where,
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    const invoiceOrderIds = [...new Set(dbInvoices.map((inv) => inv.orderId))];
    const invoiceOrders = invoiceOrderIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: invoiceOrderIds } },
          include: {
            diningTable: {
              select: {
                tableNumber: true,
                section: true,
              },
            },
            orderItems: {
              include: {
                menuItem: {
                  select: {
                    name: true,
                    code: true,
                    isVeg: true,
                  },
                },
              },
            },
          },
        })
      : [];
    const orderById = new Map(invoiceOrders.map((o) => [o.id, o]));

    const payments = invoiceOrderIds.length > 0
      ? await prisma.payment.findMany({
          where: { orderId: { in: invoiceOrderIds } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const paymentsByOrder = new Map<string, typeof payments>();
    for (const p of payments) {
      if (!paymentsByOrder.has(p.orderId)) {
        paymentsByOrder.set(p.orderId, []);
      }
      paymentsByOrder.get(p.orderId)!.push(p);
    }

    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'D',location:'reporting.ts:GET /invoices',message:'invoice list one row per invoice',data:{orderCount:invoiceOrders.length,dbInvoiceCount:dbInvoices.length,uniqueInvoiceOrderIds:invoiceOrderIds.length},timestamp:Date.now(),runId:'split-post'})}).catch(()=>{});
    // #endregion

    const invoices = dbInvoices.map((inv) => {
      const o = orderById.get(inv.orderId);
      const orderPayments = (o && paymentsByOrder.get(o.id)) || [];
      const matchingPay = orderPayments[inv.splitIndex] || orderPayments[0];
      const paymentMethod = orderPayments.length > 1
        ? (matchingPay?.method || "SPLIT")
        : (matchingPay?.method || "CASH");
      const paymentStatus = matchingPay?.status || "CAPTURED";

      const subtotalMinor = inv.amountMinor - (inv.taxAmountMinor ?? 0n);
      const taxTotalMinor = inv.taxAmountMinor ?? 0n;
      const discountTotalMinor = o?.discountTotal ?? 0n;

      const items = (o?.orderItems || []).map((item) => ({
        id: item.id,
        name: item.menuItem?.name || `Item ${item.menuItemId || ""}`.trim() || "Menu Item",
        quantity: Number(item.quantity),
        priceMinor: String(item.unitPrice ?? 0n),
        totalMinor: String((item as any).totalPrice ?? (item.unitPrice ? BigInt(Math.round(Number(item.quantity))) * item.unitPrice : 0n)),
        isVeg: item.menuItem?.isVeg ?? true,
      }));

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        orderNumber: o?.orderNumber || null,
        orderType: o?.orderType || null,
        status: o?.status || "COMPLETED",
        tableNumber: o?.diningTable?.tableNumber || o?.table_number || null,
        section: o?.diningTable?.section || null,
        subtotalMinor: String(subtotalMinor),
        taxTotalMinor: String(taxTotalMinor),
        discountTotalMinor: String(discountTotalMinor),
        grandTotalMinor: String(inv.amountMinor),
        paymentMethod,
        paymentStatus,
        itemCount: (o?.orderItems || []).reduce((sum, it) => sum + Number(it.quantity), 0),
        splitIndex: inv.splitIndex,
        items,
        createdAt: (o?.settledAt || inv.createdAt).toISOString(),
      };
    });

    res.status(200).json(invoices);
  } catch (err) {
    console.error("Error fetching settled invoices:", err);
    res.status(500).json({ error: "Failed to fetch settled invoices" });
  }
});

router.get("/live-occupancy", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;

    const allTables = await prisma.diningTable.findMany({
      where: { outletId, isActive: true },
      select: { id: true, status: true }
    });

    const totalTables = allTables.length;
    const occupiedTables = allTables.filter(t => t.status === "OCCUPIED").length;
    
    const occupancyRate = totalTables > 0 ? (occupiedTables / totalTables) * 100 : 0;

    res.status(200).json({
      totalTables,
      occupiedTables,
      occupancyRatePercent: occupancyRate.toFixed(2),
    });
  } catch (error: any) {
    console.error("Error fetching live occupancy:", error);
    res.status(500).json({ error: "internal error" });
  }
});

export const reportingRouter = router;

