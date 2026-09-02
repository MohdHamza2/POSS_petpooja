import { Router } from "express";
import { requireAuth, requirePermission, AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";
import {
  ZReportGenerator,
  TaxEngine,
  PrismaFinanceRepository,
  listRefunds,
  listLedgerEntries,
} from "@kapmeta/finance";
import type { RefundStatus } from "@kapmeta/shared-types/finance";
import { writeAuditLog } from "@kapmeta/shared-types/audit-log";
import { settleOrderCommand } from "../orchestration/settle-order";
import { outletBusinessDayWindow } from "../outlet-business-day";

export const financeRouter = Router();
const zReportGenerator = new ZReportGenerator(prisma);
const financeRepository = new PrismaFinanceRepository(prisma);

const VALID_REFUND_STATUSES: RefundStatus[] = ["INITIATED", "PENDING", "SUCCESS", "FAILED"];

// Calculate Tax for a given subtotal
financeRouter.post("/calculate-tax", requireAuth, (req: AuthedRequest, res) => {
  const { subTotalMinor } = req.body;
  if (subTotalMinor === undefined) {
    return res.status(400).json({ error: "Missing subTotalMinor" });
  }

  try {
    const taxData = TaxEngine.calculateStatutoryTaxes(BigInt(subTotalMinor));
    // JSON.stringify doesn't handle BigInt, convert to string
    res.json({
      subTotal: taxData.subTotal.toString(),
      cgst: taxData.cgst.toString(),
      sgst: taxData.sgst.toString(),
      grandTotal: taxData.grandTotal.toString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Settle an Order
financeRouter.post("/settle", requireAuth, requirePermission("bill.settle"), async (req: AuthedRequest, res) => {
  const { orderId, payments, paymentMethod, amountPaidMinor } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await settleOrderCommand(prisma, {
      outletId: req.auth!.outletId,
      orderId,
      userId: req.auth!.userId,
      paymentMethod,
      amountPaidMinor,
      payments,
    });
    res.status(200).json(result);
  } catch (error: any) {
    if (error?.message === "ALREADY_SETTLED" || error?.code === "ALREADY_SETTLED") {
      return res.status(409).json({ error: "Order already settled", code: "ALREADY_SETTLED" });
    }
    res.status(500).json({ error: error.message });
  }
});

// Z-Report
financeRouter.get("/z-report", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  const dateParam = req.query.date as string | undefined;
  const window = await outletBusinessDayWindow(req.auth!.outletId, dateParam || null);
  const date = new Date(window.businessDate + "T00:00:00");
  
  try {
    const report = await zReportGenerator.generateDailyReport(req.auth!.outletId, window.businessDate);
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'Z1',location:'finance.ts:GET /z-report',message:'z-report window vs picker',data:{dateParam:dateParam||null,parsedDate:date.toISOString(),reportDate:report.date,businessDayStart:report.businessDayStart,businessDayEnd:report.businessDayEnd,invoiceCount:report.invoiceCount,grandTotal:report.grandTotal.toString(),paymentModeKeys:Object.keys(report.paymentModes||{}),tzOffsetMin:new Date().getTimezoneOffset()},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
    // #endregion
    
    // convert bigints
    const paymentModesStr: Record<string, string> = {};
    for (const [k, v] of Object.entries(report.paymentModes)) {
      paymentModesStr[k] = v.toString();
    }

    res.status(200).json({
      ...report,
      totalSales: report.totalSales.toString(),
      totalTax: report.totalTax.toString(),
      grandTotal: report.grandTotal.toString(),
      totalTips: report.totalTips.toString(),
      totalServiceCharge: report.totalServiceCharge.toString(),
      handoverCashCounted: report.handoverCashCounted.toString(),
      handoverTipPayout: report.handoverTipPayout.toString(),
      handoverDigitalTips: report.handoverDigitalTips.toString(),
      paymentModes: paymentModesStr
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reprint an invoice — increments reprintCount for leakage tracking.
financeRouter.post("/invoices/:id/reprint", requireAuth, requirePermission("bill.reprint"), async (req: AuthedRequest, res) => {
  const { id } = req.params;

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { id } });
      if (!existing || existing.outletId !== req.auth!.outletId) {
        return null;
      }

      const updated = await tx.invoice.update({
        where: { id },
        data: { reprintCount: { increment: 1 } },
      });

      await writeAuditLog(tx, {
        outletId: req.auth!.outletId,
        userId: req.auth!.userId,
        action: "INVOICE_REPRINTED",
        entityType: "PAYMENT",
        entityId: id,
        beforeState: { reprintCount: existing.reprintCount },
        afterState: { reprintCount: updated.reprintCount },
      });

      return updated;
    });

    if (!invoice) {
      return res.status(404).json({ error: "invoice not found" });
    }

    res.status(200).json({
      ...invoice,
      amount: invoice.amountMinor.toString(),
      taxAmount: invoice.taxAmountMinor.toString(),
      waivedOffMinor: invoice.waivedOffMinor.toString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Waive off an invoice balance — records the waived amount and reason for leakage tracking.
financeRouter.post("/invoices/:id/waive-off", requireAuth, requirePermission("bill.settle"), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const { waivedOffMinor, waivedOffReason } = req.body;

  if (waivedOffMinor === undefined || waivedOffMinor === null) {
    return res.status(400).json({ error: "Missing waivedOffMinor" });
  }
  if (typeof waivedOffReason !== "string" || waivedOffReason.trim().length === 0) {
    return res.status(400).json({ error: "Missing or empty waivedOffReason" });
  }

  let waivedOffAmount: bigint;
  try {
    waivedOffAmount = BigInt(waivedOffMinor);
  } catch {
    return res.status(400).json({ error: "waivedOffMinor must be a valid integer" });
  }
  if (waivedOffAmount <= 0n) {
    return res.status(400).json({ error: "waivedOffMinor must be a positive integer" });
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { id } });
      if (!existing || existing.outletId !== req.auth!.outletId) {
        return null;
      }

      const updated = await tx.invoice.update({
        where: { id },
        data: { waivedOffMinor: waivedOffAmount, waivedOffReason },
      });

      await writeAuditLog(tx, {
        outletId: req.auth!.outletId,
        userId: req.auth!.userId,
        action: "INVOICE_WAIVED_OFF",
        entityType: "PAYMENT",
        entityId: id,
        beforeState: { waivedOffMinor: existing.waivedOffMinor.toString(), waivedOffReason: existing.waivedOffReason },
        afterState: { waivedOffMinor: updated.waivedOffMinor.toString(), waivedOffReason: updated.waivedOffReason },
        reasonCode: waivedOffReason,
      });

      return updated;
    });

    if (!invoice) {
      return res.status(404).json({ error: "invoice not found" });
    }

    res.status(200).json({
      ...invoice,
      amount: invoice.amountMinor.toString(),
      taxAmount: invoice.taxAmountMinor.toString(),
      waivedOffMinor: invoice.waivedOffMinor.toString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List ledger entries for the outlet, optionally filtered by date range / account.
financeRouter.get("/ledger-entries", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const parsedFrom = fromDate ? new Date(fromDate) : undefined;
    const parsedTo = toDate ? new Date(toDate) : undefined;

    const logs = await prisma.auditLog.findMany({
      where: {
        outletId,
        createdAt: {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const entries = logs.map((log) => {
      const st = (log.afterState as any) || {};
      return {
        id: log.id,
        sourceType: log.entityType || "AUDIT",
        sourceId: log.entityId || log.id,
        account: st.category ? `EXPENSE:${st.category}` : "GENERAL_LEDGER",
        debitMinor: st.amountMinor ? String(st.amountMinor) : "0",
        creditMinor: "0",
        externalRef: log.action || "ENTRY",
        status: "POSTED",
        createdAt: log.createdAt.toISOString(),
        postedAt: log.createdAt.toISOString(),
      };
    });

    res.status(200).json(entries);
  } catch (error: any) {
    console.error("Error in GET /ledger-entries:", error);
    res.status(200).json([]);
  }
});

// List refunds for the outlet, optionally filtered by date range / status.
financeRouter.get("/refunds", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
    const parsedFrom = fromDate ? new Date(fromDate) : undefined;
    const parsedTo = toDate ? new Date(toDate) : undefined;

    const refunds = await prisma.order_refunds.findMany({
      where: {
        outlet_id: outletId,
        created_at: {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json(
      refunds.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        paymentId: r.refund_id,
        amountMinor: r.amount_minor.toString(),
        reasonCode: "CUSTOMER_REQUEST",
        status: "SUCCESS",
        isPartial: false,
        createdAt: r.created_at.toISOString(),
      }))
    );
  } catch (error: any) {
    console.error("Error in GET /refunds:", error);
    res.status(200).json([]);
  }
});

// GET /finance/cash-drawer — real-time cash drawer status & reconciliation metrics
financeRouter.get("/cash-drawer", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const dateParam = req.query.date as string | undefined;
    const { start: startOfDay, end: endOfDay, businessDate: localDateStr } = await outletBusinessDayWindow(
      outletId,
      dateParam || null,
    );

    // 1. Query Cash Payments for the day
    const cashPayments = await prisma.payment.findMany({
      where: {
        outletId,
        method: "CASH",
        status: "CAPTURED",
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });
    const cashSalesMinor = cashPayments.reduce((sum, p) => sum + p.amount, 0n);

    // 2. Query Cash Refunds for the day
    const refunds = await prisma.order_refunds.findMany({
      where: {
        outlet_id: outletId,
        created_at: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
    });
    const cashRefundsMinor = refunds.reduce((sum, r) => sum + r.amount_minor, 0n);

    const session = await prisma.cash_drawer_sessions.findFirst({
      where: { outlet_id: outletId, status: "OPEN" },
      orderBy: { opened_at: "desc" },
    });

    const ledgerRows = await prisma.petty_cash_ledger.findMany({
      where: {
        outlet_id: outletId,
        created_at: { gte: startOfDay, lt: endOfDay },
      },
      orderBy: { created_at: "desc" },
    });

    const expenses = await Promise.all(
      ledgerRows.map(async (row) => {
        let loggedBy = "Staff";
        const u = await prisma.user.findUnique({ where: { id: row.recorded_by } });
        if (u) loggedBy = u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : (u.email || u.full_name || "Staff");
        return {
          id: row.id,
          amountMinor: String(row.amount_minor),
          category: row.category,
          description: row.description,
          paidTo: row.paid_to || "",
          loggedBy,
          createdAt: row.created_at.toISOString(),
        };
      })
    );

    const pettyCashTotalMinor = ledgerRows.reduce((sum, row) => sum + row.amount_minor, 0n);
    const openingFloatMinor = session?.opening_balance_minor ?? 0n;
    // DoD: expected cash is opening float + captured cash payments − refunds − petty.
    // An OPEN session's running expected_close is updated on settle, but GET always
    // recomputes from ledger rows so a mid-day open cannot hide earlier cash sales.
    const expectedCashMinor =
      openingFloatMinor + cashSalesMinor - cashRefundsMinor - pettyCashTotalMinor;
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'Z3',location:'finance.ts:cash-drawer-get',message:'cash drawer expected from ledger',data:{sessionStatus:session?.status||'NONE',opening:openingFloatMinor.toString(),cashSales:cashSalesMinor.toString(),petty:pettyCashTotalMinor.toString(),expected:expectedCashMinor.toString(),sessionExpected:session?session.expected_close_balance_minor.toString():null,cashTxCount:cashPayments.length,windowStart:startOfDay.toISOString(),windowEnd:endOfDay.toISOString(),dateParam:dateParam||null,businessDate:localDateStr},timestamp:Date.now(),runId:'post-fix'})}).catch(()=>{});
    // #endregion

    res.status(200).json({
      outletId,
      date: localDateStr,
      sessionId: session?.id || null,
      sessionStatus: session?.status || "NONE",
      openingFloatMinor: openingFloatMinor.toString(),
      cashSalesMinor: cashSalesMinor.toString(),
      cashRefundsMinor: cashRefundsMinor.toString(),
      pettyCashTotalMinor: pettyCashTotalMinor.toString(),
      expectedCashMinor: expectedCashMinor.toString(),
      actualCashCountedMinor: session?.actual_close_balance_minor != null ? session.actual_close_balance_minor.toString() : null,
      varianceMinor: session?.discrepancy_minor != null ? session.discrepancy_minor.toString() : "0",
      isReconciled: session?.status === "CLOSED",
      reconciledAt: session?.closed_at ? session.closed_at.toISOString() : null,
      notes: session?.notes || "",
      cashTxCount: cashPayments.length,
      expenses,
    });
  } catch (error: any) {
    console.error("Error in GET /cash-drawer:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /finance/petty-cash — record a petty cash outflow
financeRouter.post("/petty-cash", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const { amountMinor, category, description, paidTo } = req.body;

    if (!amountMinor || BigInt(amountMinor) <= 0n) {
      res.status(400).json({ error: "amountMinor must be a positive integer" });
      return;
    }
    if (!category || typeof category !== "string") {
      res.status(400).json({ error: "category is required" });
      return;
    }

    const amount = BigInt(amountMinor);
    const session = await prisma.cash_drawer_sessions.findFirst({
      where: { outlet_id: outletId, status: "OPEN" },
      orderBy: { opened_at: "desc" },
    });

    const row = await prisma.petty_cash_ledger.create({
      data: {
        outlet_id: outletId,
        amount_minor: amount,
        category: category.trim(),
        description: (description || "").trim(),
        paid_to: (paidTo || "").trim() || null,
        recorded_by: userId,
        cash_drawer_session_id: session?.id || null,
      },
    });

    if (session) {
      await prisma.cash_drawer_sessions.update({
        where: { id: session.id },
        data: {
          expected_close_balance_minor: { decrement: amount },
          updated_at: new Date(),
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    import("../websockets").then(({ broadcast }) => {
      broadcast("finance.petty_cash", {
        outletId,
        sessionId: session?.id || null,
        amountMinor: String(amount),
        category: row.category,
      });
    }).catch(err => console.error('Background task error:', err?.message || err));
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'P1',location:'finance.ts:POST petty-cash',message:'petty cash recorded and broadcast',data:{amountMinor:String(amount),category:row.category,hasOpenSession:Boolean(session)},timestamp:Date.now(),runId:'petty-shift'})}).catch(()=>{});
    // #endregion
    res.status(201).json({
      id: row.id,
      amountMinor: String(amount),
      category: row.category,
      description: row.description,
      paidTo: row.paid_to || "",
      loggedBy: user?.full_name || user?.firstName || "Staff",
      createdAt: row.created_at.toISOString(),
    });
  } catch (error: any) {
    console.error("Error in POST /petty-cash:", error);
    res.status(500).json({ error: error.message });
  }
});

financeRouter.post("/cash-drawer/open", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const existing = await prisma.cash_drawer_sessions.findFirst({
      where: { outlet_id: outletId, status: "OPEN" },
    });
    if (existing) {
      return res.status(409).json({ error: "A cash drawer session is already open", sessionId: existing.id });
    }
    const opening = BigInt(req.body.openingFloatMinor ?? req.body.opening_balance_minor ?? 0);
    const { start: startOfDay, end: endOfDay } = await outletBusinessDayWindow(outletId);
    const cashToday = await prisma.payment.findMany({
      where: { outletId, method: "CASH", status: "CAPTURED", createdAt: { gte: startOfDay, lt: endOfDay } },
    });
    const cashSalesMinor = cashToday.reduce((sum, p) => sum + p.amount, 0n);
    const pettyToday = await prisma.petty_cash_ledger.aggregate({
      where: { outlet_id: outletId, created_at: { gte: startOfDay, lt: endOfDay } },
      _sum: { amount_minor: true },
    });
    const petty = pettyToday._sum.amount_minor ?? 0n;
    const seededExpected = opening + cashSalesMinor - petty;
    const session = await prisma.cash_drawer_sessions.create({
      data: {
        outlet_id: outletId,
        opened_by: req.auth!.userId,
        opening_balance_minor: opening,
        expected_close_balance_minor: seededExpected,
        status: "OPEN",
        notes: req.body.notes || null,
      },
    });
    res.status(201).json({
      sessionId: session.id,
      openingFloatMinor: session.opening_balance_minor.toString(),
      status: session.status,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const handleReconcileShift = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const counted = req.body.actualCashCountedMinor ?? req.body.actualCountMinor ?? req.body.countedCashMinor;
    if (counted === undefined || counted === null) {
      res.status(400).json({ error: "actualCashCountedMinor or countedCashMinor is required" });
      return;
    }

    const session = await prisma.cash_drawer_sessions.findFirst({
      where: { outlet_id: outletId, status: "OPEN" },
      orderBy: { opened_at: "desc" },
    });
    if (!session) {
      res.status(409).json({ error: "No open cash drawer session" });
      return;
    }

    const actualCounted = BigInt(counted);
    const { start: startOfDay, end: endOfDay } = await outletBusinessDayWindow(outletId);
    const cashToday = await prisma.payment.findMany({
      where: { outletId, method: "CASH", status: "CAPTURED", createdAt: { gte: startOfDay, lt: endOfDay } },
    });
    const cashSalesMinor = cashToday.reduce((sum, p) => sum + p.amount, 0n);
    const pettyToday = await prisma.petty_cash_ledger.aggregate({
      where: { outlet_id: outletId, created_at: { gte: startOfDay, lt: endOfDay } },
      _sum: { amount_minor: true },
    });
    const expectedCashMinor =
      session.opening_balance_minor + cashSalesMinor - (pettyToday._sum.amount_minor ?? 0n);
    const varianceMinor = actualCounted - expectedCashMinor;

    const closed = await prisma.cash_drawer_sessions.update({
      where: { id: session.id },
      data: {
        status: "CLOSED",
        closed_by: userId,
        closed_at: new Date(),
        actual_close_balance_minor: actualCounted,
        discrepancy_minor: varianceMinor,
        notes: (req.body.notes || req.body.managerNotes || session.notes || "").trim(),
        updated_at: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      id: closed.id,
      expectedCashMinor: expectedCashMinor.toString(),
      actualCashCountedMinor: actualCounted.toString(),
      varianceMinor: varianceMinor.toString(),
      isReconciled: true,
    });
  } catch (error: any) {
    console.error("Error in reconcile shift:", error);
    res.status(500).json({ error: error.message });
  }
};

financeRouter.post("/cash-drawer/reconcile", requireAuth, requirePermission("report.read"), handleReconcileShift);
financeRouter.post("/reconcile-shift", requireAuth, requirePermission("report.read"), handleReconcileShift);
financeRouter.post("/close-shift", requireAuth, requirePermission("report.read"), handleReconcileShift);

// POST /finance/card-settlement — Reconcile EDC/Card Machine batch
financeRouter.post("/card-settlement", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const { batchAmountMinor, terminalId, notes } = req.body;

    if (batchAmountMinor === undefined) {
      return res.status(400).json({ error: "batchAmountMinor is required" });
    }

    const { start: startOfDay, end: endOfDay } = await outletBusinessDayWindow(outletId);
    
    // Find digital payments today
    const digitalPayments = await prisma.payment.aggregate({
      where: {
        outletId,
        method: { in: ["CARD", "UPI"] },
        status: "CAPTURED",
        createdAt: { gte: startOfDay, lt: endOfDay }
      },
      _sum: { amount: true }
    });

    const expectedDigitalMinor = digitalPayments._sum.amount ?? 0n;
    const actualBatchMinor = BigInt(batchAmountMinor);
    const varianceMinor = actualBatchMinor - expectedDigitalMinor;

    // Log the EDC settlement
    const log = await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: userId,
        action: "UPDATE",
        entityType: "FINANCE_EDC_SETTLEMENT",
        entityId: terminalId || "EDC-01",
        beforeState: { expectedDigitalMinor: String(expectedDigitalMinor) },
        afterState: { actualBatchMinor: String(actualBatchMinor), varianceMinor: String(varianceMinor), notes },
        createdAt: new Date(),
      }
    });

    res.status(200).json({
      success: true,
      expectedDigitalMinor: String(expectedDigitalMinor),
      actualBatchMinor: String(actualBatchMinor),
      varianceMinor: String(varianceMinor),
      logId: log.id
    });
  } catch (error: any) {
    console.error("Error in card-settlement:", error);
    res.status(500).json({ error: error.message });
  }
});

import { createHash } from "crypto";

// POST /finance/z-report/seal — Finalize the day and generate a tamper-proof hash
financeRouter.post("/z-report/seal", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  const dateParam = req.body.date as string | undefined;
  try {
    const outletId = req.auth!.outletId;
    const window = await outletBusinessDayWindow(outletId, dateParam || null);
    
    // Check if already sealed
    const existingSeal = await prisma.auditLog.findFirst({
      where: { outletId, entityType: "FINANCE_Z_REPORT", action: "APPROVE", entityId: window.businessDate }
    });
    if (existingSeal) {
      return res.status(409).json({ error: "Z-Report for this business date is already sealed." });
    }

    const report = await zReportGenerator.generateDailyReport(outletId, window.businessDate);
    
    const hashPayload = JSON.stringify({
      outletId,
      date: report.date,
      grandTotal: report.grandTotal.toString(),
      totalSales: report.totalSales.toString(),
      invoiceCount: report.invoiceCount,
    });
    
    const hash = createHash('sha256').update(hashPayload).digest('hex');

    const log = await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: req.auth!.userId,
        action: "APPROVE",
        entityType: "FINANCE_Z_REPORT",
        entityId: window.businessDate,
        afterState: { 
          hash, 
          signature: hashPayload,
          grandTotal: report.grandTotal.toString(),
          totalSales: report.totalSales.toString() 
        },
        createdAt: new Date(),
      }
    });

    res.status(200).json({ success: true, hash, logId: log.id, businessDate: window.businessDate });
  } catch (error: any) {
    console.error("Error sealing z-report:", error);
    res.status(500).json({ error: error.message });
  }
});


