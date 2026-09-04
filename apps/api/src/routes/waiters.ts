import { Router } from "express";
import { TERMINAL_ORDER_STATUSES } from "@kapmeta/orders";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";
import { writeAuditLog } from "@kapmeta/shared-types/audit-log";
import { prisma } from "../prisma";
import { outletBusinessDayWindow } from "../outlet-business-day";
const router = Router();

async function waiterBusinessDayStart(outletId: string): Promise<Date> {
  const window = await outletBusinessDayWindow(outletId);
  return window.start;
}

/** Covers opened today plus overnight tickets that settle on this business day. */
function waiterShiftOrderWhere(outletId: string, userId: string, dayStart: Date) {
  return {
    outletId,
    created_by: userId,
    OR: [{ createdAt: { gte: dayStart } }, { settledAt: { gte: dayStart } }],
  };
}

// Called periodically by the waiter app while a waiter is on the floor —
// touches their most recent active session so managers can see who's live.
router.post("/waiters/heartbeat", requireAuth, async (req: AuthedRequest, res) => {
  res.status(200).json({ ok: true });
});

// Manager floor-monitor: who's logged in right now, and which tables they're
// actively handling (derived live from open orders, not a stale cache).
router.get("/waiters/active", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const sessions = await prisma.session.findMany({
      where: {
        outletId: req.auth!.outletId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    });

    // De-dupe by user (a user can hold multiple live sessions across devices)
    const byUser = new Map<string, { userId: string; name: string; lastSeenAt: Date }>();
    for (const s of sessions) {
      if (!byUser.has(s.userId)) {
        const name = s.user.full_name || `${s.user.firstName || ''} ${s.user.lastName || ''}`.trim() || s.user.email || "Staff";
        byUser.set(s.userId, { userId: s.userId, name, lastSeenAt: s.createdAt });
      }
    }

    const openOrders = await prisma.order.findMany({
      where: {
        outletId: req.auth!.outletId,
        created_by: { in: Array.from(byUser.keys()) },
        status: { in: ["DRAFT", "PLACED", "CONFIRMED", "KOT_CREATED", "IN_PREPARATION", "READY", "SERVED", "HANDED_OVER"] },
        diningTableId: { not: null },
      },
      include: { diningTable: { select: { tableNumber: true } } },
    });
    const tablesByWaiter = new Map<string, string[]>();
    for (const o of openOrders) {
      const num = o.diningTable?.tableNumber;
      if (!num || !o.created_by) continue;
      const list = tablesByWaiter.get(o.created_by) || [];
      if (!list.includes(num)) list.push(num);
      tablesByWaiter.set(o.created_by, list);
    }

    const waiters = Array.from(byUser.values()).map((w) => ({
      ...w,
      activeTables: tablesByWaiter.get(w.userId) || [],
    }));

    res.status(200).json(waiters);
  } catch (err) {
    console.error("Error in GET /waiters/active:", err);
    res.status(200).json([]);
  }
});

// A waiter's own shift stats — self-serve, no special permission beyond
// being logged in (report.read stays reserved for the manager-facing
// cross-waiter monitor above). Everything here is a real aggregate over
// today's Order rows for req.auth.userId — no fabricated numbers.
router.get("/waiters/me/stats", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const dayStart = await waiterBusinessDayStart(req.auth!.outletId);

    const orders = await prisma.order.findMany({
      where: waiterShiftOrderWhere(req.auth!.outletId, req.auth!.userId, dayStart),
    });


    const tablesServed = new Set(orders.map((o) => o.diningTableId).filter(Boolean)).size;
    const completedOrders = orders.filter((o) => o.status === "COMPLETED");
    const avgOrderMinutes =
      completedOrders.length === 0
        ? null
        : Math.round(
            (completedOrders.reduce((sum, o) => sum + (o.updatedAt.getTime() - o.createdAt.getTime()), 0) /
              completedOrders.length /
              60000) *
              10
          ) / 10;
    const tipsMinor = orders.reduce((sum, o) => sum + (o.tipTotal || 0n), 0n);
    const serviceChargeMinor = orders.reduce((sum, o) => sum + (o.serviceChargeTotal || 0n), 0n);
    const revenueMinor = orders.reduce((sum, o) => sum + BigInt(o.grandTotal || 0), 0n);


    res.status(200).json({
      ordersToday: orders.length,
      tablesServed,
      completedOrders: completedOrders.length,
      avgOrderMinutes,
      tipsMinor: tipsMinor.toString(),
      serviceChargeMinor: serviceChargeMinor.toString(),
      revenueMinor: revenueMinor.toString(),
    });
  } catch (err: any) {
    console.error("Error fetching waiter stats:", err);
    res.status(500).json({ error: err.message || "internal error" });
  }
});

// Comprehensive shift cash and tips reconciliation ledger for the logged-in waiter.
// Aggregates real cash, card, and UPI payment transactions + bill tips.
router.get("/waiters/me/shift-reconciliation", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const dayStart = await waiterBusinessDayStart(req.auth!.outletId);

    const [user, orders, payments] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.auth!.userId },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      prisma.order.findMany({
        where: waiterShiftOrderWhere(req.auth!.outletId, req.auth!.userId, dayStart),
        include: {
          diningTable: { select: { tableNumber: true, section: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.payment.findMany({
        where: {
          outletId: req.auth!.outletId,
          createdAt: { gte: dayStart },
        },
      }),
    ]);
    const myOrderIds = new Set(orders.map((o) => o.id));
    const myPayments = payments.filter((p) => myOrderIds.has(p.orderId));

    const successfulPayments = myPayments.filter(
      (p) => p.status === "SUCCESS" || p.status === "CAPTURED" || p.status === "COMPLETED"
    );

    const cashSalesMinor = successfulPayments
      .filter((p) => p.method === "CASH")
      .reduce((sum, p) => sum + p.amount, 0n);


    const cardSalesMinor = successfulPayments
      .filter((p) => p.method === "CARD")
      .reduce((sum, p) => sum + p.amount, 0n);

    const upiSalesMinor = successfulPayments
      .filter((p) => p.method === "UPI")
      .reduce((sum, p) => sum + p.amount, 0n);

    const totalTipsMinor = orders.reduce((sum, o) => sum + (o.tipTotal || 0n), 0n);
    const totalServiceChargeMinor = orders.reduce((sum, o) => sum + (o.serviceChargeTotal || 0n), 0n);
    const totalGrandMinor = orders.reduce((sum, o) => sum + o.grandTotal, 0n);

    res.status(200).json({
      waiter: {
        id: user?.id,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : "Captain",
        email: user?.email,
      },
      shiftDate: dayStart.toISOString(),
      orderCount: orders.length,
      cashSalesMinor: cashSalesMinor.toString(),
      cardSalesMinor: cardSalesMinor.toString(),
      upiSalesMinor: upiSalesMinor.toString(),
      digitalTipsMinor: totalTipsMinor.toString(),
      serviceChargeMinor: totalServiceChargeMinor.toString(),
      totalRevenueMinor: totalGrandMinor.toString(),
      recentOrders: orders.slice(0, 10).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        tableNumber: o.diningTable?.tableNumber || "Direct",
        section: o.diningTable?.section || "Non AC",
        grandTotalMinor: o.grandTotal.toString(),
        tipTotalMinor: (o.tipTotal || 0n).toString(),
        serviceChargeTotalMinor: (o.serviceChargeTotal || 0n).toString(),
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        paymentMethods: myPayments.filter((p) => p.orderId === o.id).map((p) => p.method),
      })),
    });
  } catch (err: any) {
    console.error("Error generating shift reconciliation:", err);
    res.status(500).json({ error: err.message || "internal error" });
  }
});

// Captain handover: persist this waiter's counted cash + tips. Does NOT close the outlet cash drawer.
router.post("/waiters/me/shift-handover", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const waiterName = user
      ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Captain"
      : "Captain";
    const dayWindow = await outletBusinessDayWindow(req.auth!.outletId);
    const payload = {
      actualCashCountedMinor: Number(req.body.actualCashCountedMinor || 0),
      openingFloatMinor: Number(req.body.openingFloatMinor || 0),
      netTipPayoutMinor: Number(req.body.netTipPayoutMinor || 0),
      digitalTipsMinor: Number(req.body.digitalTipsMinor || 0),
      serviceChargeMinor: Number(req.body.serviceChargeMinor || 0),
      cashSalesMinor: Number(req.body.cashSalesMinor || 0),
      managerNotes: String(req.body.managerNotes || "").slice(0, 2000),
      waiterName,
    };
    const row = await prisma.waiterShiftHandover.create({
      data: {
        outletId: req.auth!.outletId,
        waiterId: req.auth!.userId,
        waiterName,
        businessDate: new Date(`${dayWindow.businessDate}T12:00:00`),
        actualCashCountedMinor: BigInt(payload.actualCashCountedMinor),
        openingFloatMinor: BigInt(payload.openingFloatMinor),
        netTipPayoutMinor: BigInt(payload.netTipPayoutMinor),
        digitalTipsMinor: BigInt(payload.digitalTipsMinor),
        serviceChargeMinor: BigInt(payload.serviceChargeMinor),
        cashSalesMinor: BigInt(payload.cashSalesMinor),
        managerNotes: payload.managerNotes || null,
      },
    });
    await writeAuditLog(prisma as any, {
      outletId: req.auth!.outletId,
      userId: req.auth!.userId,
      action: "waiter.shift_handover",
      entityType: "USER",
      entityId: req.auth!.userId,
      afterState: { ...payload, handoverId: row.id },
      reasonCode: "SHIFT_HANDOVER",
    });
    import("../websockets").then(({ broadcast }) => {
      broadcast("finance.waiter_shift_handover", {
        waiterId: req.auth!.userId,
        outletId: req.auth!.outletId,
        ...payload,
      });
    }).catch(err => console.error('Background task error:', err?.message || err));
    res.status(200).json({ ok: true, ...payload });
  } catch (err: any) {
    console.error("Error recording waiter shift handover:", err);
    res.status(500).json({ error: err.message || "internal error" });
  }
});

router.get("/waiters/shift-handovers", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const rows = await prisma.waiterShiftHandover.findMany({
      where: { outletId: req.auth!.outletId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.status(200).json(
      rows.map((row) => ({
        id: row.id,
        waiterId: row.waiterId,
        waiterName: row.waiterName,
        createdAt: row.createdAt.toISOString(),
        businessDate: `${row.businessDate.getFullYear()}-${String(row.businessDate.getMonth() + 1).padStart(2, "0")}-${String(row.businessDate.getDate()).padStart(2, "0")}`,
        actualCashCountedMinor: Number(row.actualCashCountedMinor),
        openingFloatMinor: Number(row.openingFloatMinor),
        netTipPayoutMinor: Number(row.netTipPayoutMinor),
        digitalTipsMinor: Number(row.digitalTipsMinor),
        serviceChargeMinor: Number(row.serviceChargeMinor),
        cashSalesMinor: Number(row.cashSalesMinor),
        managerNotes: row.managerNotes || "",
      }))
    );
  } catch (err: any) {
    console.error("Error listing waiter shift handovers:", err);
    res.status(500).json({ error: err.message || "internal error" });
  }
});

export const waitersRouter = router;
