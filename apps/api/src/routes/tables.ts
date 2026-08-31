import { Router } from "express";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";
import { transitionOrder, PrismaOrderRepository } from "@kapmeta/orders";
import { writeAuditLog } from "@kapmeta/shared-types/audit-log";
import {
  applyMergeGroup,
  dissolveMergeGroupForTable,
  dissolvePaidEmptyMergeGroups,
  expandMergeMemberIds,
  findLiveOrdersOnTables,
  foldOrdersInto,
  resolveAnchorTable,
  stampOrderMergeLabel,
} from "../orchestration/table-merge";

const orderRepo = new PrismaOrderRepository(prisma);
export const tablesRouter = Router();

const OPEN_ORDER_STATUSES = [
  "DRAFT",
  "PLACED",
  "CONFIRMED",
  "KOT_CREATED",
  "IN_PREPARATION",
  "READY",
  "SERVED",
  "HANDED_OVER",
] as const;

const QUEUED_KOT_STATUSES = new Set(["QUEUED", "KOT_CREATED", "PENDING"]);
const COOKING_KOT_STATUSES = new Set(["PREPARING", "IN_PREPARATION", "COOKING"]);

function isLiveFloorSession(order: any): boolean {
  if (order.advanceStatus === "HELD") return false;
  const kots = order.kotTickets || [];
  const items = order.orderItems || [];
  const unserved = kots.some(
    (k: any) => k.status !== "CANCELLED" && k.status !== "SERVED"
  );
  if (order.status === "COMPLETED") return unserved;
  if (unserved) return true;
  if (kots.some((k: any) => k.status !== "CANCELLED")) return true;
  if (order.status === "DRAFT" && items.length > 0) return true;
  if (order.status === "SERVED" || order.status === "HANDED_OVER") return true;
  return false;
}

function deriveKitchenStage(activeOrder: any): "QUEUED" | "COOKING" | "READY" | "SERVED" | null {
  const kots = activeOrder.kotTickets || [];
  const statuses = kots.map((k: any) => k.status);
  const stage = kots.some((k: any) => QUEUED_KOT_STATUSES.has(k.status))
    ? "QUEUED"
    : kots.some((k: any) => COOKING_KOT_STATUSES.has(k.status))
      ? "COOKING"
      : kots.some((k: any) => k.status === "READY")
        ? "READY"
        : null;
  // #region agent log
  if (kots.length > 1 && new Set(statuses).size > 1) {
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'C',location:'tables.ts:deriveKitchenStage',message:'mixed KOT statuses',data:{orderId:activeOrder.id,statuses,stage},timestamp:Date.now(),runId:'wave3'})}).catch(()=>{});
  }
  // #endregion
  if (stage) return stage;
  if (
    (kots.some((k: any) => k.status === "SERVED") && kots.every((k: any) => k.status === "SERVED" || k.status === "CANCELLED")) ||
    activeOrder.status === "SERVED" ||
    activeOrder.status === "HANDED_OVER"
  ) {
    return "SERVED";
  }
  return null;
}

function deriveFloorStatus(activeOrder: any): "RUNNING" | "RUNNING_KOT" | "PRINTED" | "PAID" {
  const kots = activeOrder.kotTickets || [];
  if (activeOrder.status === "PAID" || activeOrder.status === "SETTLED") return "PAID";
  if (activeOrder.status === "PRINTED" || activeOrder.status === "BILLING") return "PRINTED";
  if (kots.some((k: any) => k.status !== "CANCELLED")) return "RUNNING_KOT";
  return "RUNNING";
}

function serializeCurrentOrder(activeOrder: any) {
  return {
    id: activeOrder.id,
    orderNumber: activeOrder.orderNumber,
    status: activeOrder.status,
    grandTotalPaise: Number(activeOrder.grandTotal || (activeOrder as any).grandTotalMinor || 0),
    totalAmount: Number(activeOrder.grandTotal || (activeOrder as any).grandTotalMinor || 0) / 100,
    guestCount: (activeOrder as any).guestCount || null,
    createdAt: activeOrder.createdAt,
    kots: (activeOrder.kotTickets || []).map((k: any) => ({
      id: k.id,
      ticketNumber: k.ticketNumber,
      status: k.status,
      createdAt: k.createdAt,
      items: (k.kotItems || []).map((ki: any) => ({
        id: ki.id,
        name: ki.menuItem?.name || ki.notes || "Item",
        quantity: ki.quantity,
        status: ki.status || k.status,
      })),
    })),
    items: (activeOrder.orderItems || []).map((oi: any) => ({
      id: oi.id,
      menuItemId: oi.menuItemId,
      menuItemName: oi.menuItem?.name || oi.item_name || "Item",
      quantity: oi.quantity,
      unitPriceMinor: Number(oi.unitPrice || oi.unitPriceMinor || 0),
      subtotalMinor: Number(oi.subtotal || oi.subtotalMinor || 0),
      notes: oi.notes,
    })),
  };
}

function mergeFieldsForTable(t: any, members: any[]) {
  const group = members.length > 0 ? members : [t];
  return {
    mergeGroupId: t.mergeGroupId || null,
    mergePrimaryTableId: t.mergePrimaryTableId || null,
    mergedWith: group.map((m: any) => m.tableNumber),
    isMergePrimary: Boolean(t.mergeGroupId) && t.id === t.mergePrimaryTableId,
    groupCapacity: group.reduce((sum: number, m: any) => sum + (m.capacity || 0), 0),
  };
}

// GET /tables - Occupancy is a projection of open orders, never stored dining_tables.status alone
tablesRouter.get("/tables", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const dissolvedOrphans = await dissolvePaidEmptyMergeGroups(prisma, outletId);
    if (dissolvedOrphans.length > 0) {
    }
    const tables = await (prisma.diningTable as any).findMany({
      where: { outletId, isActive: true },
      orderBy: { tableNumber: "asc" },
    });

    const tableIds = tables.map((t: any) => t.id);
    const activeOrders = await (prisma.order as any).findMany({
      where: {
        outletId,
        diningTableId: { in: tableIds },
        OR: [
          { status: { in: [...OPEN_ORDER_STATUSES] } },
          {
            status: "COMPLETED",
            kotTickets: { some: { status: { notIn: ["SERVED", "CANCELLED"] } } },
          },
        ],
      },
      include: {
        kotTickets: {
          include: {
            kotItems: {
              include: {
                menuItem: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        orderItems: {
          include: {
            menuItem: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const orderMap = new Map<string, any>();
    activeOrders.forEach((ord: any) => {
      if (ord.diningTableId && isLiveFloorSession(ord) && !orderMap.has(ord.diningTableId)) {
        orderMap.set(ord.diningTableId, ord);
      }
    });

    const groupMembers = new Map<string, any[]>();
    for (const t of tables) {
      if (!t.mergeGroupId) continue;
      const arr = groupMembers.get(t.mergeGroupId) || [];
      arr.push(t);
      groupMembers.set(t.mergeGroupId, arr);
    }

    const orderForTable = (t: any) => {
      const own = orderMap.get(t.id);
      if (own) return own;
      if (t.mergePrimaryTableId) return orderMap.get(t.mergePrimaryTableId) || null;
      if (t.mergeGroupId) {
        const members = groupMembers.get(t.mergeGroupId) || [];
        const primary = members.find((m: any) => m.id === t.mergePrimaryTableId) || members[0];
        if (primary) return orderMap.get(primary.id) || null;
      }
      return null;
    };

    const occupiedNoOrder = tables.filter(
      (t: any) => t.status !== "VACANT" && !orderForTable(t) && !t.mergeGroupId
    );
    const vacantWithOrder = tables.filter((t: any) => t.status === "VACANT" && orderMap.has(t.id));

    if (occupiedNoOrder.length > 0) {
      await prisma.diningTable.updateMany({
        where: { id: { in: occupiedNoOrder.map((t: any) => t.id) } },
        data: { status: "VACANT" },
      }).catch(() => {});
    }
    if (vacantWithOrder.length > 0) {
      await prisma.diningTable.updateMany({
        where: { id: { in: vacantWithOrder.map((t: any) => t.id) } },
        data: { status: "OCCUPIED" },
      }).catch(() => {});
    }

    const mapped = tables.map((t: any) => {
      const members = t.mergeGroupId ? groupMembers.get(t.mergeGroupId) || [t] : [t];
      const extra = mergeFieldsForTable(t, members);
      const activeOrder = orderForTable(t);
      if (!activeOrder) {
        return {
          id: t.id,
          outletId: t.outletId,
          tableNumber: t.tableNumber,
          name: t.tableNumber,
          capacity: extra.groupCapacity || t.capacity,
          section: t.section,
          status: t.mergeGroupId ? "RUNNING" : "VACANT",
          kitchenStage: null,
          isActive: t.isActive,
          activeOrderId: null,
          active_order_id: null,
          currentOrder: null,
          ...extra,
        };
      }

      const kitchenStage = deriveKitchenStage(activeOrder);
      const computedStatus = deriveFloorStatus(activeOrder);

      return {
        id: t.id,
        outletId: t.outletId,
        tableNumber: t.tableNumber,
        name: t.tableNumber,
        capacity: extra.groupCapacity || t.capacity,
        section: t.section,
        status: computedStatus,
        kitchenStage,
        isActive: t.isActive,
        activeOrderId: activeOrder.id,
        active_order_id: activeOrder.id,
        currentOrder: serializeCurrentOrder(activeOrder),
        ...extra,
      };
    });


    res.status(200).json(mapped);
  } catch (err) {
    console.error("Error listing tables:", err);
    res.status(500).json({ error: "Failed to list tables" });
  }
});

// POST /tables/:id/vacant - Explicitly release and mark table as VACANT
tablesRouter.post("/tables/:id/vacant", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tableId = req.params.id;

    const table = await prisma.diningTable.findFirst({
      where: { id: tableId, outletId },
    });

    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    const anchor = await resolveAnchorTable(prisma, outletId, tableId);
    const liveOrders = await findLiveOrdersOnTables(prisma, outletId, [anchor?.id || tableId]);
    const liveOrder = liveOrders[0];
    if (liveOrder) {
      const bill = await orderRepo.getBill(outletId, liveOrder.id).catch(() => null);
      const due = bill ? Number(bill.dueMinor || 0) : Number(liveOrder.grandTotal || 0);
      if (due > 0) {
        return res.status(409).json({
          error: "Table has an unpaid running order. Collect payment before vacating.",
        });
      }
      const unserved = (liveOrder.kotTickets || []).some(
        (k: any) => k.status !== "CANCELLED" && k.status !== "SERVED"
      );
      if (unserved) {
        return res.status(409).json({
          error: "Kitchen still has unserved tickets. Table stays occupied until food is served.",
        });
      }
    }

    const dissolved = await dissolveMergeGroupForTable(prisma, outletId, tableId);
    const vacatedIds = dissolved.ids.length > 0 ? dissolved.ids : [tableId];

    await (prisma.order as any).updateMany({
      where: {
        outletId,
        diningTableId: { in: vacatedIds },
        status: { in: ["SERVED", "HANDED_OVER", "COMPLETED", "SETTLED", "PAID"] },
      },
      data: {
        diningTableId: null,
      },
    }).catch(() => {});

    import("../websockets").then(({ broadcast }) => {
      for (const id of vacatedIds) {
        broadcast("table.status_updated", {
          tableId: id,
          status: "VACANT",
          stage: null,
        });
      }
    }).catch(() => {});

    res.status(200).json({
      ok: true,
      message: `Table ${table.tableNumber} is now marked VACANT.`,
      tableId,
      vacatedTableIds: vacatedIds,
      status: "VACANT",
    });
  } catch (err: any) {
    console.error("Error vacating table:", err);
    res.status(500).json({ error: err.message || "Failed to vacate table" });
  }
});

// POST /tables/:id/serve - Mark all ready KOTs for a table as SERVED and deduct BOM stock
tablesRouter.post("/tables/:id/serve", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tableId = req.params.id;
    const userId = req.auth!.userId;

    const table = await prisma.diningTable.findFirst({
      where: { id: tableId, outletId },
    });

    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    const anchor = await resolveAnchorTable(prisma, outletId, tableId);
    const activeOrder = await (prisma.order as any).findFirst({
      where: {
        outletId,
        diningTableId: anchor?.id || tableId,
        status: { in: ["DRAFT", "PLACED", "CONFIRMED", "KOT_CREATED", "IN_PREPARATION", "READY", "SERVED"] },
      },
      include: {
        kotTickets: {
          where: { status: { notIn: ["CANCELLED", "SERVED"] } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!activeOrder) {
      return res.status(404).json({ error: "Active table order not found" });
    }

    const kotsToServe = (activeOrder.kotTickets || []).filter((k: any) => k.status === "READY");
    if (kotsToServe.length === 0) {
      return res.status(409).json({ error: "No READY tickets to serve. Wait until kitchen marks food ready." });
    }

    // Transition READY KOT tickets to SERVED only — queued/cooking stay live
    for (const kot of kotsToServe) {
      await prisma.kOTTicket.update({
        where: { id: kot.id },
        data: { status: "SERVED", servedAt: new Date() },
      }).catch(() => {});
    }

    // Update order status to SERVED only when no queued/cooking tickets remain
    const leftover = (activeOrder.kotTickets || []).filter(
      (k: any) => k.status !== "CANCELLED" && k.status !== "READY" && k.status !== "SERVED"
    );
    const stillCooking = leftover.length > 0;
    if (
      !stillCooking &&
      activeOrder.status !== "COMPLETED" &&
      activeOrder.status !== "SETTLED" &&
      activeOrder.status !== "PAID"
    ) {
      await transitionOrder(activeOrder.id, "SERVED" as any, orderRepo, userId).catch(() => {});
    }
    const stage = stillCooking
      ? deriveKitchenStage({ kotTickets: leftover, status: activeOrder.status }) || "QUEUED"
      : "SERVED";

    import("../websockets").then(({ broadcast }) => {
      broadcast("kot.status_updated", {
        kotTicketIds: kotsToServe.map((k: any) => k.id),
        status: "SERVED",
        tableId,
        orderId: activeOrder.id,
      });
      broadcast("table.status_updated", {
        tableId,
        orderId: activeOrder.id,
        stage,
      });
      broadcast("order.status_updated", {
        orderId: activeOrder.id,
        tableId,
        stage,
      });
    }).catch(() => {});

    res.status(200).json({
      ok: true,
      message: stillCooking
        ? `Ready food for Table ${table.tableNumber} served. Other tickets still in kitchen.`
        : `All food for Table ${table.tableNumber} is marked SERVED.`,
      servedKotsCount: kotsToServe.length,
      stage,
    });
  } catch (err: any) {
    console.error("Error serving table food:", err);
    res.status(500).json({ error: err.message || "Failed to mark food served" });
  }
});

// GET /tables/occupancy - Real-time table occupancy & floor capacity metrics
tablesRouter.get("/tables/occupancy", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tables = await prisma.diningTable.findMany({
      where: { outletId, isActive: true },
      include: {
        orders: {
          where: {
            OR: [
              { status: { in: [...OPEN_ORDER_STATUSES] } },
              {
                status: "COMPLETED",
                kotTickets: { some: { status: { notIn: ["SERVED", "CANCELLED"] } } },
              },
            ],
          },
          include: {
            kotTickets: true,
            orderItems: true,
          },
        },
      },
      orderBy: { tableNumber: "asc" },
    });

    const totalTables = tables.length;
    let occupiedTables = 0;
    let totalCapacity = 0;
    let occupiedCapacity = 0;

    const sectionMap = new Map<string, {
      section: string;
      totalTables: number;
      occupiedTables: number;
      vacantTables: number;
      totalCapacity: number;
      occupiedCapacity: number;
    }>();

    const liveGroupIds = new Set<string>();
    for (const t of tables) {
      const groupId = (t as any).mergeGroupId as string | null;
      if (groupId && t.orders.some((ord: any) => isLiveFloorSession(ord))) {
        liveGroupIds.add(groupId);
      }
    }

    for (const t of tables) {
      const groupId = (t as any).mergeGroupId as string | null;
      const isOccupied =
        t.orders.some((ord: any) => isLiveFloorSession(ord))
        || Boolean(groupId && liveGroupIds.has(groupId));
      const cap = t.capacity || 4;
      totalCapacity += cap;

      if (isOccupied) {
        occupiedTables += 1;
        occupiedCapacity += cap;
      }

      const secName = t.section || "Main Floor";
      if (!sectionMap.has(secName)) {
        sectionMap.set(secName, {
          section: secName,
          totalTables: 0,
          occupiedTables: 0,
          vacantTables: 0,
          totalCapacity: 0,
          occupiedCapacity: 0,
        });
      }

      const sec = sectionMap.get(secName)!;
      sec.totalTables += 1;
      sec.totalCapacity += cap;
      if (isOccupied) {
        sec.occupiedTables += 1;
        sec.occupiedCapacity += cap;
      } else {
        sec.vacantTables += 1;
      }
    }

    const vacantTables = totalTables - occupiedTables;
    const occupancyRatePercent = totalTables > 0 ? (occupiedTables / totalTables) * 100 : 0;
    const capacityUtilizationPercent = totalCapacity > 0 ? (occupiedCapacity / totalCapacity) * 100 : 0;

    const sections = Array.from(sectionMap.values()).map((s) => ({
      ...s,
      occupancyRatePercent: s.totalTables > 0 ? Number(((s.occupiedTables / s.totalTables) * 100).toFixed(1)) : 0,
    }));

    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'W2',location:'tables.ts:GET /occupancy',message:'occupancy snapshot',data:{occupiedTables,totalTables,occupancyRatePercent:Number(occupancyRatePercent.toFixed(1)),liveGroupCount:liveGroupIds.size},timestamp:Date.now(),runId:'waiter-e2e'})}).catch(()=>{});
    // #endregion
    res.status(200).json({
      outletId,
      totalTables,
      occupiedTables,
      vacantTables,
      occupancyRatePercent: Number(occupancyRatePercent.toFixed(1)),
      totalCapacity,
      occupiedCapacity,
      capacityUtilizationPercent: Number(capacityUtilizationPercent.toFixed(1)),
      sections,
    });
  } catch (err) {
    console.error("Error computing table occupancy:", err);
    res.status(500).json({ error: "Failed to compute table occupancy" });
  }
});

// POST /tables - Create a new dining table
tablesRouter.post("/tables", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const { tableNumber, name, capacity, section } = req.body;
    const num = tableNumber || name;
    if (!num) {
      return res.status(400).json({ error: "Table number is required" });
    }

    const existing = await prisma.diningTable.findFirst({
      where: {
        outletId,
        tableNumber: String(num).trim(),
      },
    });

    if (existing) {
      if (!existing.isActive) {
        // Reactivate existing table
        const reactivated = await prisma.diningTable.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            status: "VACANT",
            capacity: capacity ? Number(capacity) : existing.capacity,
            section: section || existing.section,
          },
        });
        return res.status(201).json({
          id: reactivated.id,
          outletId: reactivated.outletId,
          tableNumber: reactivated.tableNumber,
          name: reactivated.tableNumber,
          capacity: reactivated.capacity,
          section: reactivated.section,
          status: "VACANT",
          isActive: reactivated.isActive,
        });
      }
      return res.status(409).json({ error: `Table "${num}" already exists in this outlet.` });
    }

    const table = await prisma.diningTable.create({
      data: {
        outletId,
        tableNumber: String(num).trim(),
        capacity: capacity ? Number(capacity) : 4,
        section: section ? String(section).trim() : "Main Dining",
        status: "VACANT",
      },
    });

    res.status(201).json({
      id: table.id,
      outletId: table.outletId,
      tableNumber: table.tableNumber,
      name: table.tableNumber,
      capacity: table.capacity,
      section: table.section,
      status: table.status,
      isActive: table.isActive,
    });
  } catch (err: any) {
    console.error("Error creating table:", err);
    res.status(500).json({ error: err.message || "Failed to create table" });
  }
});

// GET /tables/sections - List distinct sections for the outlet
tablesRouter.get("/tables/sections", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tables = await prisma.diningTable.findMany({
      where: { outletId, isActive: true },
      select: { section: true },
    });
    const sections = Array.from(new Set(tables.map((t) => t.section || "Main Hall"))).filter(Boolean);
    if (sections.length === 0) {
      sections.push("AC Dining", "Main Hall", "Outdoor Garden", "First Floor");
    }
    res.status(200).json(sections);
  } catch (err) {
    console.error("Error listing table sections:", err);
    res.status(500).json({ error: "Failed to list table sections" });
  }
});

// GET /tables/:id - Get table details
tablesRouter.get("/tables/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    if (req.params.id.length < 30) {
      return res.status(404).json({ error: "Table not found" });
    }
    const table = await prisma.diningTable.findFirst({
      where: { id: req.params.id, outletId },
      include: {
        orders: {
          where: {
            OR: [
              { status: { in: [...OPEN_ORDER_STATUSES] } },
              {
                status: "COMPLETED",
                kotTickets: { some: { status: { notIn: ["SERVED", "CANCELLED"] } } },
              },
            ],
          },
          include: {
            orderItems: true,
            kotTickets: true,
          },
          orderBy: { createdAt: "desc" },
        },
      } as any,
    });

    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }

    const activeOrder = ((table as any).orders || []).find((ord: any) => isLiveFloorSession(ord)) || null;
    res.status(200).json({
      id: table.id,
      outletId: table.outletId,
      tableNumber: table.tableNumber,
      name: table.tableNumber,
      capacity: table.capacity,
      section: table.section,
      status: activeOrder ? deriveFloorStatus(activeOrder) : "VACANT",
      kitchenStage: activeOrder ? deriveKitchenStage(activeOrder) : null,
      isActive: table.isActive,
      activeOrderId: activeOrder?.id || null,
      active_order_id: activeOrder?.id || null,
      order: activeOrder || null,
    });
  } catch (err) {
    console.error("Error fetching table:", err);
    res.status(500).json({ error: "Failed to fetch table" });
  }
});

// PUT /tables/:id - Update table properties
tablesRouter.put("/tables/:id", requireAuth, requirePermission("settings.manage"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const { tableNumber, name, capacity, section, status, isActive } = req.body;

    const table = await prisma.diningTable.update({
      where: { id: req.params.id, outletId },
      data: {
        ...(tableNumber || name ? { tableNumber: String(tableNumber || name) } : {}),
        ...(capacity !== undefined ? { capacity: Number(capacity) } : {}),
        ...(section !== undefined ? { section } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });

    res.status(200).json(table);
  } catch (err) {
    console.error("Error updating table:", err);
    res.status(500).json({ error: "Failed to update table" });
  }
});

// POST & PATCH /tables/:id/status - Update table status
const handleTableStatus = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: "status is required" });
    }

    const existing = await prisma.diningTable.findFirst({
      where: { id: req.params.id, outletId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Table not found" });
    }

    if (status === "VACANT") {
      const liveOrders = await findLiveOrdersOnTables(prisma, outletId, [req.params.id]);
      const liveOrder = liveOrders[0];
      if (liveOrder) {
        const bill = await orderRepo.getBill(outletId, liveOrder.id).catch(() => null);
        const due = bill ? Number(bill.dueMinor || 0) : Number(liveOrder.grandTotal || 0);
        if (due > 0) {
          return res.status(409).json({
            error: "Table has an unpaid running order. Collect payment before vacating.",
          });
        }
        await (prisma.order as any).updateMany({
          where: {
            outletId,
            diningTableId: req.params.id,
            status: { in: ["SERVED", "HANDED_OVER", "COMPLETED", "SETTLED", "PAID"] },
          },
          data: { diningTableId: null },
        }).catch(() => {});
      }
    }

    const table = await prisma.diningTable.update({
      where: { id: req.params.id },
      data: { status },
    });

    import("../websockets").then(({ broadcast }) => {
      broadcast("table.status_updated", { tableId: req.params.id, status });
    }).catch(() => {});

    res.status(200).json(table);
  } catch (err: any) {
    console.error("Error updating table status:", err);
    res.status(500).json({ error: err.message || "Failed to update table status" });
  }
};

tablesRouter.post("/tables/:id/status", requireAuth, handleTableStatus);
tablesRouter.patch("/tables/:id/status", requireAuth, handleTableStatus);

// POST /tables/transfer & POST /tables/:id/transfer - Transfer or merge active table orders
const handleTableTransfer = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const sourceTableId = req.params.id || req.body.sourceTableId || req.body.fromTableId;
    const targetTableId = req.body.targetTableId || req.body.toTableId;
    const transferMode = req.body.transferMode || "FULL_TABLE";

    if (!sourceTableId || !targetTableId) {
      return res.status(400).json({ error: "Both sourceTableId and targetTableId are required" });
    }
    if (sourceTableId === targetTableId) {
      return res.status(400).json({ error: "Source and target table cannot be the same" });
    }

    const [sourceTable, targetTable] = await Promise.all([
      prisma.diningTable.findFirst({ where: { id: sourceTableId, outletId } }),
      prisma.diningTable.findFirst({ where: { id: targetTableId, outletId } }),
    ]);

    if (!sourceTable) {
      return res.status(404).json({ error: "Source table not found" });
    }
    if (!targetTable) {
      return res.status(404).json({ error: "Target table not found" });
    }

    // Find active order on source table
    const sourceOrder = await prisma.order.findFirst({
      where: {
        outletId,
        diningTableId: sourceTableId,
        status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!sourceOrder) {
      return res.status(400).json({ error: `Table ${sourceTable.tableNumber} has no active running order to transfer.` });
    }

    const kotTicketId = typeof req.body.kotTicketId === "string" ? req.body.kotTicketId : "";
    let transferredOrderId = sourceOrder.id;
    let sourceVacated = true;

    if (transferMode === "KOT") {
      if (!kotTicketId) {
        return res.status(400).json({ error: "kotTicketId is required when transferMode is KOT" });
      }
      const ticket = await prisma.kOTTicket.findFirst({
        where: { id: kotTicketId, outletId },
        include: { kotItems: true },
      });
      if (!ticket || ticket.orderId !== sourceOrder.id) {
        return res.status(400).json({ error: "KOT ticket not found on the source table order" });
      }
      const orderItemIds = ticket.kotItems.map((ki) => ki.orderItemId).filter((id): id is string => !!id);
      if (orderItemIds.length === 0) {
        return res.status(400).json({ error: "That KOT has no linked order items to move" });
      }
      const movedItems = await prisma.orderItem.findMany({
        where: { id: { in: orderItemIds }, orderId: sourceOrder.id, isVoided: false },
      });
      if (movedItems.length === 0) {
        return res.status(400).json({ error: "No live order items remain on that KOT" });
      }
      const movedSubtotal = movedItems.reduce((sum, i) => sum + i.subtotal, 0n);
      const sourceSub = sourceOrder.subtotal || 0n;
      const movedTax =
        sourceSub > 0n ? (sourceOrder.taxTotal || 0n) * movedSubtotal / sourceSub : 0n;
      const movedGrand = movedSubtotal + movedTax;

      transferredOrderId = await prisma.$transaction(async (tx) => {
        let targetOrder = await tx.order.findFirst({
          where: {
            outletId,
            diningTableId: targetTableId,
            status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
          },
          orderBy: { createdAt: "desc" },
        });

        if (!targetOrder) {
          const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          const count = await tx.order.count({
            where: { outletId, orderNumber: { startsWith: dateKey } },
          });
          targetOrder = await tx.order.create({
            data: {
              outletId,
              orderNumber: `${dateKey}-${String(count + 1).padStart(4, "0")}`,
              orderType: sourceOrder.orderType,
              status: sourceOrder.status,
              business_date: sourceOrder.business_date,
              subtotal: movedSubtotal,
              taxTotal: movedTax,
              grandTotal: movedGrand,
              diningTableId: targetTableId,
              table_number: targetTable.tableNumber,
              created_by: sourceOrder.created_by,
            },
          });
        } else {
          await tx.order.update({
            where: { id: targetOrder.id },
            data: {
              subtotal: { increment: movedSubtotal },
              taxTotal: { increment: movedTax },
              grandTotal: { increment: movedGrand },
            },
          });
        }

        await tx.orderItem.updateMany({
          where: { id: { in: movedItems.map((i) => i.id) } },
          data: { orderId: targetOrder.id },
        });
        await tx.kOTTicket.update({
          where: { id: ticket.id },
          data: { orderId: targetOrder.id },
        });

        await tx.order.update({
          where: { id: sourceOrder.id },
          data: {
            subtotal: { decrement: movedSubtotal },
            taxTotal: { decrement: movedTax },
            grandTotal: { decrement: movedGrand },
          },
        });

        const remaining = await tx.orderItem.count({
          where: { orderId: sourceOrder.id, isVoided: false },
        });
        if (remaining === 0) {
          await tx.order.update({
            where: { id: sourceOrder.id },
            data: { status: "CANCELLED" },
          });
          await tx.diningTable.update({
            where: { id: sourceTableId },
            data: { status: "VACANT" },
          });
        }
        await tx.diningTable.update({
          where: { id: targetTableId },
          data: { status: "OCCUPIED" },
        });
        return targetOrder.id;
      });
      const leftover = await prisma.orderItem.count({
        where: { orderId: sourceOrder.id, isVoided: false },
      });
      sourceVacated = leftover === 0;
    } else {
      const targetOrder = await prisma.order.findFirst({
        where: {
          outletId,
          diningTableId: targetTableId,
          status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
        },
        orderBy: { createdAt: "desc" },
      });

      await prisma.$transaction(async (tx) => {
        if (targetOrder && targetOrder.id !== sourceOrder.id) {
          await tx.orderItem.updateMany({
            where: { orderId: sourceOrder.id },
            data: { orderId: targetOrder.id },
          });
          await tx.kOTTicket.updateMany({
            where: { orderId: sourceOrder.id },
            data: { orderId: targetOrder.id },
          });
          await tx.order.update({
            where: { id: targetOrder.id },
            data: {
              subtotal: { increment: sourceOrder.subtotal },
              taxTotal: { increment: sourceOrder.taxTotal || 0n },
              grandTotal: { increment: sourceOrder.grandTotal },
              tipTotal: { increment: sourceOrder.tipTotal || 0n },
              serviceChargeTotal: { increment: sourceOrder.serviceChargeTotal || 0n },
            },
          });
          await tx.order.update({
            where: { id: sourceOrder.id },
            data: { status: "CANCELLED", diningTableId: null },
          });
          transferredOrderId = targetOrder.id;
        } else {
          await tx.order.update({
            where: { id: sourceOrder.id },
            data: {
              diningTableId: targetTableId,
              table_number: targetTable.tableNumber,
            },
          });
        }

        await tx.diningTable.update({
          where: { id: sourceTableId },
          data: { status: "VACANT" },
        });
        await tx.diningTable.update({
          where: { id: targetTableId },
          data: { status: "OCCUPIED" },
        });
      });
    }


    import("../websockets").then(({ broadcast }) => {
      broadcast("table.transferred", {
        fromTable: sourceTable.tableNumber,
        toTable: targetTable.tableNumber,
        fromTableId: sourceTableId,
        toTableId: targetTableId,
        orderId: transferredOrderId,
        transferMode,
        kotTicketId: kotTicketId || null,
        sourceVacated,
      });
      broadcast("table.status_updated", { tableId: sourceTableId, status: sourceVacated ? "VACANT" : "OCCUPIED" });
      broadcast("table.status_updated", { tableId: targetTableId, status: "OCCUPIED" });
      broadcast("kot.status_updated", { orderId: transferredOrderId, tableNumber: targetTable.tableNumber });
    }).catch(() => {});

    res.status(200).json({
      success: true,
      transferredOrderId,
      fromTable: sourceTable.tableNumber,
      toTable: targetTable.tableNumber,
      transferMode,
      kotTicketId: kotTicketId || null,
      sourceVacated,
    });
  } catch (err: any) {
    console.error("Error transferring table:", err);
    res.status(500).json({ error: err.message || "Failed to transfer table" });
  }
};

tablesRouter.post("/tables/transfer", requireAuth, handleTableTransfer);
tablesRouter.post("/tables/:id/transfer", requireAuth, handleTableTransfer);

// POST /tables/merge - Merge multiple table orders into one table (supports pre-order and active running orders)
const handleTableMerge = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const rawSourceIds = req.body.sourceTableIds || req.body.sourceIds || req.body.tableIds;
    const targetTableId = req.body.targetTableId || req.body.toTableId || req.body.destinationTableId;

    if (!Array.isArray(rawSourceIds) || rawSourceIds.length === 0 || !targetTableId) {
      return res.status(400).json({ error: "sourceTableIds array and targetTableId are required" });
    }

    const sourceTableIds = rawSourceIds.filter((id) => id !== targetTableId);
    if (sourceTableIds.length === 0) {
      return res.status(400).json({ error: "Source tables must be different from target table" });
    }

    const targetTable = await prisma.diningTable.findFirst({
      where: { id: targetTableId, outletId },
    });
    if (!targetTable) {
      return res.status(404).json({ error: "Target table not found" });
    }

    const memberIds = await expandMergeMemberIds(prisma, outletId, [
      ...sourceTableIds,
      targetTableId,
    ]);
    const memberTables = await prisma.diningTable.findMany({
      where: { outletId, id: { in: memberIds } },
    });
    const liveOrders = await findLiveOrdersOnTables(prisma, outletId, memberIds);
    const existingGroupId = memberTables.find((t: any) => t.mergeGroupId)?.mergeGroupId || undefined;
    let survivorOrderId: string | null = null;

    if (liveOrders.length === 0) {
    } else {
      const survivor =
        liveOrders.find((o: any) => o.diningTableId === targetTableId) || liveOrders[0];
      survivorOrderId = survivor.id;
      const others = liveOrders.filter((o: any) => o.id !== survivor.id);
      const mergePath = survivor.diningTableId === targetTableId ? "group-keep-primary-order" : "group-promote-live-order";

      await prisma.$transaction(async (tx) => {
        await foldOrdersInto(tx, survivor, others, {
          id: targetTableId,
          tableNumber: targetTable.tableNumber,
        });
      });
    }

    const applied = await applyMergeGroup(prisma, {
      outletId,
      memberIds,
      primaryTableId: targetTableId,
      groupId: existingGroupId,
    });

    if (survivorOrderId) {
      await stampOrderMergeLabel(prisma, outletId, survivorOrderId, targetTableId);
    }

    const afterMembers = await prisma.diningTable.findMany({
      where: { outletId, id: { in: memberIds } },
      select: { id: true, tableNumber: true, status: true, mergeGroupId: true, mergePrimaryTableId: true, capacity: true },
    });

    import("../websockets").then(({ broadcast }) => {
      broadcast("table.merged", {
        sourceTableIds,
        targetTableId,
        targetTableNumber: targetTable.tableNumber,
        targetOrderId: survivorOrderId,
        mergeGroupId: applied.mergeGroupId,
        memberIds,
        memberNumbers: afterMembers.map((t: any) => t.tableNumber),
        preOrder: liveOrders.length === 0,
      });
      for (const m of afterMembers) {
        broadcast("table.status_updated", { tableId: m.id, status: "OCCUPIED" });
      }
    }).catch(() => {});

    await writeAuditLog(prisma, {
      outletId,
      userId: req.auth!.userId,
      action: "TABLE_MERGE",
      entityType: "DINING_TABLE",
      entityId: targetTableId,
      afterState: {
        sourceTableIds,
        targetTableId,
        mergeGroupId: applied.mergeGroupId,
        memberIds,
        mergedOrdersCount: liveOrders.length,
        targetOrderId: survivorOrderId,
      },
    }).catch(() => undefined);

    res.status(200).json({
      success: true,
      mergedOrdersCount: liveOrders.length,
      mergedTablesCount: memberIds.length,
      preOrder: liveOrders.length === 0,
      targetTableId,
      targetTableNumber: targetTable.tableNumber,
      targetOrderId: survivorOrderId,
      mergeGroupId: applied.mergeGroupId,
      memberIds,
      memberNumbers: afterMembers.map((t: any) => t.tableNumber),
      sourcesVacated: false,
    });
  } catch (err: any) {
    console.error("Error merging tables:", err);
    res.status(500).json({ error: err.message || "Failed to merge tables" });
  }
};

tablesRouter.post("/tables/merge", requireAuth, handleTableMerge);

tablesRouter.post("/tables/unmerge", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tableId = req.body.tableId || req.body.id;
    if (!tableId) {
      return res.status(400).json({ error: "tableId is required" });
    }
    const table = await (prisma.diningTable as any).findFirst({
      where: { id: tableId, outletId },
    });
    if (!table) {
      return res.status(404).json({ error: "Table not found" });
    }
    if (!table.mergeGroupId) {
      return res.status(409).json({ error: "Table is not in a merge group" });
    }

    const members = await (prisma.diningTable as any).findMany({
      where: { outletId, mergeGroupId: table.mergeGroupId },
    });
    const primaryId = table.mergePrimaryTableId || members.find((m: any) => m.id === table.mergePrimaryTableId)?.id;
    const isPrimary = table.id === primaryId;

    if (isPrimary) {
      const satelliteIds = members.filter((m: any) => m.id !== table.id).map((m: any) => m.id);
      if (satelliteIds.length > 0) {
        await (prisma.diningTable as any).updateMany({
          where: { id: { in: satelliteIds } },
          data: { status: "VACANT", mergeGroupId: null, mergePrimaryTableId: null },
        });
      }
      await (prisma.diningTable as any).update({
        where: { id: table.id },
        data: { mergeGroupId: null, mergePrimaryTableId: null },
      });
    } else {
      await (prisma.diningTable as any).update({
        where: { id: table.id },
        data: { status: "VACANT", mergeGroupId: null, mergePrimaryTableId: null },
      });
      const remaining = members.filter((m: any) => m.id !== table.id);
      if (remaining.length <= 1) {
        const leftoverIds = remaining.map((m: any) => m.id);
        if (leftoverIds.length > 0) {
          await (prisma.diningTable as any).updateMany({
            where: { id: { in: leftoverIds } },
            data: { mergeGroupId: null, mergePrimaryTableId: null },
          });
        }
      }
    }

    import("../websockets").then(({ broadcast }) => {
      broadcast("table.unmerged", { tableId, mergeGroupId: table.mergeGroupId });
      for (const m of members) {
        broadcast("table.status_updated", {
          tableId: m.id,
          status: m.id === tableId && !isPrimary ? "VACANT" : m.status,
        });
      }
    }).catch(() => {});

    res.status(200).json({ ok: true, tableId, dissolvedPrimary: isPrimary });
  } catch (err: any) {
    console.error("Error unmerging table:", err);
    res.status(500).json({ error: err.message || "Failed to unmerge table" });
  }
});

// PATCH /tables/:id - Update table configuration (capacity, section, tableNumber, isActive)
tablesRouter.patch("/tables/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tableId = req.params.id;
    const { tableNumber, capacity, section, isActive } = req.body;

    const existing = await prisma.diningTable.findFirst({
      where: { id: tableId, outletId },
    });

    if (!existing) {
      return res.status(404).json({ error: "Table not found" });
    }

    // Guard: Cannot disable table with running orders/KOTs
    if (isActive === false) {
      const activeOrder = await prisma.order.findFirst({
        where: {
          outletId,
          diningTableId: tableId,
          status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
        },
      });
      if (activeOrder) {
        return res.status(400).json({
          error: `Cannot disable Table ${existing.tableNumber} while it has active running order #${activeOrder.orderNumber}. Settle or transfer the order first.`,
        });
      }
    }

    const data: any = {};
    if (tableNumber !== undefined) data.tableNumber = String(tableNumber).trim();
    if (capacity !== undefined) data.capacity = Number(capacity) || 4;
    if (section !== undefined) data.section = String(section).trim() || "General";
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.diningTable.update({
      where: { id: tableId },
      data,
    });

    import("../websockets").then(({ broadcast }) => {
      broadcast("table.updated", {
        tableId: updated.id,
        tableNumber: updated.tableNumber,
        isActive: updated.isActive,
        capacity: updated.capacity,
        section: updated.section,
      });
    }).catch(() => {});

    res.status(200).json(updated);
  } catch (err: any) {
    console.error("Error updating table:", err);
    res.status(500).json({ error: err.message || "Failed to update table" });
  }
});

// DELETE /tables/:id - Deactivate table
tablesRouter.delete("/tables/:id", requireAuth, requirePermission("settings.manage"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const existing = await prisma.diningTable.findFirst({
      where: { id: req.params.id, outletId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Table not found" });
    }

    // Guard: Cannot disable table with running orders
    const activeOrder = await prisma.order.findFirst({
      where: {
        outletId,
        diningTableId: req.params.id,
        status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
      },
    });
    if (activeOrder) {
      return res.status(400).json({
        error: `Cannot disable Table ${existing.tableNumber} while it has active running order #${activeOrder.orderNumber}.`,
      });
    }

    await prisma.diningTable.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.status(204).end();
  } catch (err: any) {
    console.error("Error deleting table:", err);
    res.status(500).json({ error: err.message || "Failed to delete table" });
  }
});
