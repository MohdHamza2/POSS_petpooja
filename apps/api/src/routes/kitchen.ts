import { Router } from "express";
import { prisma } from "../prisma";
import { createKot, transitionKot, recallKot, PrismaKotRepository, RECALL_GRACE_WINDOW_MS } from "@kapmeta/kitchen";
import { requireAuth, requirePermission, checkPermissionDirect, type AuthedRequest } from "../middleware/require-auth";
import { mergeGroupLabelMap } from "../orchestration/table-merge";
import { deductBomStockForOrder } from "../orchestration/inventory-depletion";
import { stepOrderTo } from "../orchestration/order-lifecycle";
import type { OrderStatus } from "@kapmeta/shared-types/orders";

const router = Router();

// Stations for the KDS station-filter tabs — only ones with a live ticket
// count so the board doesn't show empty tabs for unused stations.
router.get("/stations", requireAuth, requirePermission("kot.read"), async (req: AuthedRequest, res) => {
  try {
    const stations = await prisma.station.findMany({
      where: { outletId: req.auth!.outletId },
      orderBy: { name: "asc" },
    });
    res.status(200).json(
      stations.map((s) => ({
        id: s.id,
        name: s.name,
        slaWarningSeconds: s.slaWarningSeconds,
        slaBreachSeconds: s.slaBreachSeconds,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// Per-station SLA thresholds are business config (busy stations like BAR
// need shorter fuses than GRILL) — admin-editable, not hardcoded on the
// KDS board. Reuses the same permission as Table Management/User Management
// ("menu.category.manage") since there's no dedicated station-admin screen yet.
router.patch("/stations/:stationId", requireAuth, requirePermission("menu.category.manage"), async (req: AuthedRequest, res) => {
  try {
    const { stationId } = req.params;
    const { slaWarningSeconds, slaBreachSeconds } = req.body;
    const data: { slaWarningSeconds?: number; slaBreachSeconds?: number } = {};
    if (typeof slaWarningSeconds === "number" && slaWarningSeconds > 0) data.slaWarningSeconds = slaWarningSeconds;
    if (typeof slaBreachSeconds === "number" && slaBreachSeconds > 0) data.slaBreachSeconds = slaBreachSeconds;
    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: "no valid fields to update" });
      return;
    }

    const station = await prisma.station.findFirst({ where: { id: stationId, outletId: req.auth!.outletId } });
    if (!station) {
      res.status(404).json({ error: "station not found" });
      return;
    }

    const updated = await prisma.station.update({ where: { id: stationId }, data });
    res.status(200).json({
      id: updated.id,
      name: updated.name,
      slaWarningSeconds: updated.slaWarningSeconds,
      slaBreachSeconds: updated.slaBreachSeconds,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// Open tickets for the KDS board — QUEUED/PREPARING/READY, oldest first.
router.get("/kot", requireAuth, requirePermission("kot.read"), async (req: AuthedRequest, res) => {
  try {
    const { stationId } = req.query;
    // Live tickets, plus anything SERVED within the recall grace window so
    // the board can offer an "Undo" on an accidental last tap.
    const recallCutoff = new Date(Date.now() - RECALL_GRACE_WINDOW_MS);
    const whereClause: any = {
      outletId: req.auth!.outletId,
      OR: [
        {
          status: { in: ["QUEUED", "PREPARING", "READY"] },
          order: { status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] } },
        },
        { status: "SERVED", servedAt: { gt: recallCutoff } },
      ],
    };
    if (typeof stationId === "string") {
      whereClause.stationId = stationId;
    }

    const tickets = await prisma.kOTTicket.findMany({
      where: whereClause,
      include: {
        kotItems: { include: { menuItem: { select: { name: true } } } },
        station: { select: { name: true, slaWarningSeconds: true, slaBreachSeconds: true } },
        order: { select: { status: true, orderType: true, table_number: true, diningTable: { select: { id: true, tableNumber: true, mergeGroupId: true, mergePrimaryTableId: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    const groupIds = tickets
      .map((t) => (t.order as any)?.diningTable?.mergeGroupId)
      .filter((id: string | null | undefined): id is string => Boolean(id));
    const labels = await mergeGroupLabelMap(prisma, req.auth!.outletId, groupIds);


    res.status(200).json(
      tickets.map((t) => ({
        id: t.id,
        orderId: t.orderId,
        ticketNumber: t.ticketNumber,
        stationId: t.stationId,
        stationName: t.station?.name ?? null,
        slaWarningSeconds: t.station?.slaWarningSeconds ?? 600,
        slaBreachSeconds: t.station?.slaBreachSeconds ?? 900,
        status: t.status,
        createdAt: t.createdAt,
        servedAt: t.servedAt,
        orderType: t.order!.orderType,
        tableNumber:
          (t.order as any)?.table_number ||
          labels.get((t.order as any)?.diningTable?.mergeGroupId) ||
          t.order!.diningTable?.tableNumber ||
          (t.order!.orderType === "DELIVERY" ? "DELIVERY" : t.order!.orderType === "PICKUP" ? "PICKUP" : null),
        kotItems: t.kotItems.map((ki) => ({
          id: ki.id,
          quantity: ki.quantity,
          notes: ki.notes,
          course: ki.course,
          servedAt: ki.servedAt,
          menuItem: { name: ki.menuItem!.name },
        })),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/kot", requireAuth, requirePermission("order.create"), async (req: AuthedRequest, res) => {
  try {
    const repository = new PrismaKotRepository(prisma);
    const results = await createKot(req.body, repository);

    import("../websockets").then(({ broadcast }) => {
      broadcast("kot.created", { results });
    });

    res.status(201).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.patch("/kot/:kotTicketId/status", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { kotTicketId } = req.params;
    const { toStatus, reasonCode } = req.body;

    // Transitioning KOT status:
    // - Chefs / Kitchen staff / Admins with "kot.status.update", "order.create", or "kot.read" can update KOT status
    let permissionResult = await checkPermissionDirect(req.auth!.userId, req.auth!.outletId, "kot.status.update");
    if (!permissionResult.allowed) {
      permissionResult = await checkPermissionDirect(req.auth!.userId, req.auth!.outletId, "kot.read");
    }
    if (!permissionResult.allowed && (toStatus === "SERVED" || toStatus === "PREPARING" || toStatus === "READY")) {
      permissionResult = await checkPermissionDirect(req.auth!.userId, req.auth!.outletId, "order.create");
    }

    if (!permissionResult.allowed) {
      res.status(403).json({ error: permissionResult.reason });
      return;
    }

    const repository = new PrismaKotRepository(prisma);
    const result = await transitionKot(kotTicketId, toStatus, repository, req.auth!.userId, reasonCode);

    if (result.ok === false) {
      if (result.reason === "NOT_FOUND") {
        res.status(404).json({ error: "kot ticket not found" });
        return;
      }

      res.status(409).json({ error: "illegal transition", from: result.from, to: result.to });
      return;
    }

    // Cascade KOT status transition to parent Order
    const ticket = await prisma.kOTTicket.findUnique({
      where: { id: kotTicketId },
      include: { order: true, kotItems: true },
    });

    if (ticket && ticket.orderId) {
      let orderTargetStatus: any = null;
      let stage = "QUEUED";
      const siblingTickets = await prisma.kOTTicket.findMany({
        where: { orderId: ticket.orderId },
        include: { kotItems: { select: { orderItemId: true, menuItemId: true } } },
      });
      const others = siblingTickets.filter((k) => k.id !== kotTicketId);
      const stillCooking = others.filter(
        (k) =>
          k.status !== "CANCELLED" &&
          k.status !== "SERVED" &&
          k.status !== "READY"
      );

      if (result.newStatus === "PREPARING") {
        orderTargetStatus = "IN_PREPARATION";
        stage = "COOKING";
      } else if (result.newStatus === "READY") {
        if (stillCooking.length === 0) {
          orderTargetStatus = "READY";
          stage = "FOOD_READY";
        } else {
          orderTargetStatus = null;
          stage = stillCooking.some((k) => k.status === "PREPARING" || k.status === "COOKING" || k.status === "IN_PREPARATION")
            ? "COOKING"
            : "QUEUED";
        }
      } else if (result.newStatus === "SERVED") {
        const servedItemIds = (ticket.kotItems || [])
          .map((i) => i.orderItemId)
          .filter((id): id is string => Boolean(id));
        if (servedItemIds.length > 0 && ticket.order) {
          await deductBomStockForOrder(
            ticket.orderId,
            ticket.order.outletId,
            prisma,
            req.auth!.userId,
            "KOT_SERVED",
            servedItemIds
          );
        }
        const remaining = others.filter(
          (k) => k.status !== "CANCELLED" && k.status !== "SERVED"
        );
        if (remaining.length === 0) {
          orderTargetStatus = "HANDED_OVER";
          stage = "SERVED";
        } else {
          orderTargetStatus = null;
          if (remaining.some((k) => k.status === "QUEUED" || k.status === "KOT_CREATED" || k.status === "PENDING")) stage = "QUEUED";
          else if (remaining.some((k) => k.status === "PREPARING" || k.status === "COOKING" || k.status === "IN_PREPARATION")) stage = "COOKING";
          else if (remaining.some((k) => k.status === "READY")) stage = "FOOD_READY";
          else stage = "QUEUED";
        }
      }

      if (orderTargetStatus) {
        const stepResult = await stepOrderTo(
          prisma,
          ticket.orderId,
          orderTargetStatus as OrderStatus,
          req.auth!.userId
        );
      }

      import("../websockets").then(({ broadcast }) => {
        broadcast("kot.status_updated", { kotTicketId, status: result.newStatus });
        broadcast("order.status_updated", {
          orderId: ticket.orderId,
          tableId: ticket.order?.diningTableId,
          orderStatus: orderTargetStatus || ticket.order?.status,
          kotStatus: result.newStatus,
          stage,
        });
        broadcast("table.status_updated", {
          tableId: ticket.order?.diningTableId,
          orderId: ticket.orderId,
          stage,
        });
      });
    }

    res.status(200).json({ status: result.newStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/kot/:kotTicketId/recall", requireAuth, requirePermission("kot.status.update"), async (req: AuthedRequest, res) => {
  try {
    const { kotTicketId } = req.params;
    const repository = new PrismaKotRepository(prisma);
    const result = await recallKot(kotTicketId, req.auth!.userId, repository);

    if (!result.ok) {
      const status = result.reason === "NOT_FOUND" ? 404 : 409;
      res.status(status).json({ error: result.reason });
      return;
    }

    import("../websockets").then(({ broadcast }) => {
      broadcast("kot.status_updated", { kotTicketId, status: "READY" });
    });

    res.status(200).json({ status: "READY" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

// Avg prep time (QUEUED -> READY) per station over a selectable window, for
// the manager-facing kitchen throughput view. ?range=24h|7d|30d (default 24h).
const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function toMinutes(ms: number) {
  return Math.round((ms / 60000) * 10) / 10;
}

// p=0.5 for median, p=0.9 for p90. Durations must be pre-sorted ascending.
function percentile(sortedMs: number[], p: number) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor(p * sortedMs.length));
  return sortedMs[idx];
}

async function computeAggregate(outletId: string, since: Date, until: Date) {
  const tickets = await prisma.kOTTicket.findMany({
    where: { outletId, createdAt: { gt: since, lte: until } },
    include: { statusHistory: true },
  });
  const durations: number[] = [];
  for (const t of tickets) {
    const queuedAt = t.statusHistory.find((h) => h.status === "QUEUED")?.createdAt;
    const readyAt = t.statusHistory.find((h) => h.status === "READY")?.createdAt;
    if (!queuedAt || !readyAt) continue;
    durations.push(readyAt.getTime() - queuedAt.getTime());
  }
  if (durations.length === 0) return null;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

router.get("/analytics", requireAuth, requirePermission("report.read"), async (req: AuthedRequest, res) => {
  try {
    const range = typeof req.query.range === "string" && RANGE_MS[req.query.range] ? req.query.range : "24h";
    const stationFilter = typeof req.query.stationId === "string" ? req.query.stationId : null;
    const rangeMs = RANGE_MS[range];
    const now = new Date();
    const since = new Date(now.getTime() - rangeMs);
    const outletId = req.auth!.outletId;

    const tickets = await prisma.kOTTicket.findMany({
      where: {
        outletId,
        createdAt: { gt: since },
        ...(stationFilter ? { stationId: stationFilter } : {}),
      },
      include: {
        statusHistory: true,
        station: { select: { name: true, slaWarningSeconds: true, slaBreachSeconds: true } },
        kotItems: { include: { menuItem: { select: { name: true } } } },
      },
    });

    const byStation = new Map<
      string,
      { name: string; durations: number[]; slaWarningSeconds: number; slaBreachSeconds: number }
    >();
    const byItem = new Map<string, { name: string; durations: number[] }>();
    // Trend buckets so a slow patch (e.g. a rush) shows up instead of getting
    // smoothed into the range average. Hourly for 24h; daily for 7d/30d,
    // otherwise a 30-day window would render 720 unreadable bars.
    const bucketMs = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const byBucket = new Map<string, { totalMs: number; count: number }>();

    for (const t of tickets) {
      const queuedAt = t.statusHistory.find((h) => h.status === "QUEUED")?.createdAt ?? t.createdAt;
      const readyAt = t.statusHistory.find((h) => h.status === "READY" || h.status === "SERVED")?.createdAt ?? (t.servedAt || (t.status === "READY" ? t.updatedAt : null));
      if (!queuedAt || !readyAt) continue;
      const durationMs = readyAt.getTime() - queuedAt.getTime();

      const stationKey = t.stationId ?? "unassigned";
      const stationEntry = byStation.get(stationKey) ?? {
        name: t.station?.name ?? "Unassigned",
        durations: [],
        slaWarningSeconds: t.station?.slaWarningSeconds ?? 600,
        slaBreachSeconds: t.station?.slaBreachSeconds ?? 900,
      };
      stationEntry.durations.push(durationMs);
      byStation.set(stationKey, stationEntry);

      for (const ki of t.kotItems) {
        const itemEntry = byItem.get(ki.menuItemId) ?? { name: ki.menuItem!.name, durations: [] };
        itemEntry.durations.push(durationMs);
        byItem.set(ki.menuItemId, itemEntry);
      }

      const bucketKey = new Date(Math.floor(queuedAt.getTime() / bucketMs) * bucketMs).toISOString();
      const bucketEntry = byBucket.get(bucketKey) ?? { totalMs: 0, count: 0 };
      bucketEntry.totalMs += durationMs;
      bucketEntry.count += 1;
      byBucket.set(bucketKey, bucketEntry);
    }

    // Enhancement: median + p90 alongside the mean. A single slow outlier
    // ticket (e.g. a kitchen hold) drags the mean hard; median/p90 tell a
    // manager whether that's the norm or a one-off.
    const stations = Array.from(byStation.entries()).map(([stationId, v]) => {
      const sorted = [...v.durations].sort((a, b) => a - b);
      return {
        stationId,
        stationName: v.name,
        ticketCount: v.durations.length,
        avgPrepMinutes: toMinutes(v.durations.reduce((a, b) => a + b, 0) / v.durations.length),
        medianPrepMinutes: toMinutes(percentile(sorted, 0.5)),
        p90PrepMinutes: toMinutes(percentile(sorted, 0.9)),
        slaWarningMinutes: toMinutes(v.slaWarningSeconds * 1000),
        slaBreachMinutes: toMinutes(v.slaBreachSeconds * 1000),
      };
    });

    const items = Array.from(byItem.entries())
      .map(([menuItemId, v]) => {
        const sorted = [...v.durations].sort((a, b) => a - b);
        return {
          menuItemId,
          itemName: v.name,
          ticketCount: v.durations.length,
          avgPrepMinutes: toMinutes(v.durations.reduce((a, b) => a + b, 0) / v.durations.length),
          medianPrepMinutes: toMinutes(percentile(sorted, 0.5)),
          p90PrepMinutes: toMinutes(percentile(sorted, 0.9)),
        };
      })
      .sort((a, b) => b.avgPrepMinutes - a.avgPrepMinutes)
      .slice(0, 10);

    const trend = Array.from(byBucket.entries())
      .map(([bucket, v]) => ({
        bucket,
        ticketCount: v.count,
        avgPrepMinutes: toMinutes(v.totalMs / v.count),
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    // Enhancement: prior-period comparison — same-length window immediately
    // before `since`, so the UI can show "improving" / "worsening" instead
    // of a number with no reference point.
    const overallAvgMs = tickets.length
      ? (() => {
          const all: number[] = [];
          for (const t of tickets) {
            const q = t.statusHistory.find((h) => h.status === "QUEUED")?.createdAt;
            const r = t.statusHistory.find((h) => h.status === "READY")?.createdAt;
            if (q && r) all.push(r.getTime() - q.getTime());
          }
          return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
        })()
      : null;
    const previousSince = new Date(since.getTime() - rangeMs);
    const previousAvgMs = await computeAggregate(outletId, previousSince, since);
    const comparison =
      overallAvgMs !== null && previousAvgMs !== null
        ? {
            currentAvgMinutes: toMinutes(overallAvgMs),
            previousAvgMinutes: toMinutes(previousAvgMs),
            deltaPercent: Math.round(((overallAvgMs - previousAvgMs) / previousAvgMs) * 1000) / 10,
          }
        : null;

    // Enhancement: tickets still cooking right now that are already past
    // their station's SLA warning — the "what needs attention this second"
    // view, not just a historical average.
    const liveTickets = await prisma.kOTTicket.findMany({
      where: { outletId, status: { in: ["QUEUED", "PREPARING"] } },
      include: {
        statusHistory: true,
        station: { select: { name: true, slaWarningSeconds: true, slaBreachSeconds: true } },
        order: { select: { orderNumber: true } },
      },
    });
    const atRisk = liveTickets
      .map((t) => {
        const queuedAt = t.statusHistory.find((h) => h.status === "QUEUED")?.createdAt ?? t.createdAt;
        const elapsedMs = now.getTime() - queuedAt.getTime();
        const warnSec = t.station?.slaWarningSeconds ?? 600;
        const breachSec = t.station?.slaBreachSeconds ?? 900;
        return {
          kotTicketId: t.id,
          ticketNumber: t.ticketNumber,
          orderNumber: t.order?.orderNumber ?? null,
          stationName: t.station?.name ?? "Unassigned",
          elapsedMinutes: toMinutes(elapsedMs),
          status: t.status,
          severity: elapsedMs >= breachSec * 1000 ? "BREACH" : elapsedMs >= warnSec * 1000 ? "WARNING" : "OK",
        };
      })
      .filter((t) => t.severity !== "OK")
      .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);

    res.status(200).json({
      range,
      granularity: range === "24h" ? "hour" : "day",
      stationFilter,
      stations,
      items,
      trend,
      comparison,
      atRisk,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

export const kitchenRouter = router;
