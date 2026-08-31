import { Router } from "express";
import { requireAuth, checkPermissionDirect, type AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";
import {
  createOrder,
  transitionOrder,
  listOrders,
  getOrderDetail,
  addOrderItems,
  PrismaOrderRepository,
  PrismaMenuPriceLookup,
  PrismaModifierPriceLookup,
} from "@kapmeta/orders";
import type { OrderStatus, CreateOrderInput } from "@kapmeta/shared-types/orders";
import { onOrderConfirmed, onItemsAdded } from "../orchestration/order-lifecycle";
import { settleOrderCommand } from "../orchestration/settle-order";
import { TaxEngine } from "@kapmeta/finance";
import { dissolveMergeGroupForTable, expandMergeMemberIds, findLiveOrdersOnTables, occupyMergeMembers, resolveAnchorTable, stampOrderMergeLabel } from "../orchestration/table-merge";

const orderRepo = new PrismaOrderRepository(prisma);
const menuPriceLookup = new PrismaMenuPriceLookup(prisma);
const modifierPriceLookup = new PrismaModifierPriceLookup(prisma);

export const ordersRouter = Router();

// GET /orders - List orders with optional filters
ordersRouter.get("/orders", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const { status, channel, orderType, page, limit, fromDate, toDate } = req.query;

    const filter: any = {};
    if (status) filter.status = status as OrderStatus;
    if (channel) filter.channel = channel as any;
    if (orderType) filter.orderType = orderType as any;
    if (page) filter.page = Number(page);
    if (limit) filter.limit = Number(limit);
    if (fromDate) filter.fromDate = new Date(String(fromDate));
    if (toDate) filter.toDate = new Date(String(toDate));

    const orders = await listOrders(outletId, filter, orderRepo);
    res.status(200).json(orders);
  } catch (err) {
    console.error("Error listing orders:", err);
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// POST /orders - Create order
ordersRouter.post("/orders", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const body = req.body;

    // Normalize lines
    const rawLines = Array.isArray(body.lines)
      ? body.lines
      : Array.isArray(body.items)
      ? body.items
      : [];

    const lines = rawLines.map((it: any) => ({
      menuItemId: it.menuItemId || it.itemId || it.id,
      quantity: Number(it.quantity || 1),
      modifierOptionIds: Array.isArray(it.modifierOptionIds) ? it.modifierOptionIds : [],
      notes: it.notes || undefined,
      course: it.course || undefined,
      seatNumber: it.seatNumber || undefined,
    }));

    if (lines.length === 0) {
      return res.status(400).json({ error: "Order must have at least one line item" });
    }

    // Auto-resolve diningTableId if tableNumber is provided but diningTableId is missing
    let diningTableId = body.diningTableId || undefined;
    if (!diningTableId && body.tableNumber) {
      const table = await prisma.diningTable.findFirst({
        where: {
          outletId,
          tableNumber: String(body.tableNumber),
        },
      });
      if (table) {
        diningTableId = table.id;
      }
    }
    if (diningTableId) {
      const anchor = await resolveAnchorTable(prisma, outletId, diningTableId);
      if (anchor) {
        diningTableId = anchor.id;
        if (!body.tableNumber) {
          body.tableNumber = anchor.tableNumber;
        }
      }
    }

    const isHold = body.action === "HOLD";

    if (diningTableId && !isHold) {
      const liveOnAnchor = await findLiveOrdersOnTables(prisma, outletId, [diningTableId]);
      const existingLive = liveOnAnchor[0];
      if (existingLive) {
        const added = await addOrderItems(
          outletId,
          existingLive.id,
          lines,
          menuPriceLookup,
          orderRepo,
          req.auth!.userId,
          modifierPriceLookup
        );
        await onItemsAdded(existingLive.id, prisma).catch(() => {});
        if (body.action === "KOT" || body.status === "ACTIVE" || body.status === "KOT_CREATED") {
          if (existingLive.status === "DRAFT" || existingLive.status === "PLACED") {
            await transitionOrder(existingLive.id, "CONFIRMED", orderRepo, req.auth!.userId).catch(() => {});
            await transitionOrder(existingLive.id, "KOT_CREATED", orderRepo, req.auth!.userId).catch(() => {});
          }
          await onOrderConfirmed(existingLive.id, prisma).catch(() => {});
        }
        await occupyMergeMembers(prisma, outletId, diningTableId);
        await stampOrderMergeLabel(prisma, outletId, existingLive.id, diningTableId);
        const orderDetail = await getOrderDetail(outletId, existingLive.id, orderRepo);
        const attachMembers = await expandMergeMemberIds(prisma, outletId, [diningTableId]);
        import("../websockets").then(({ broadcast }) => {
          broadcast("order.updated", { orderId: existingLive.id, diningTableId });
          broadcast("kot.created", { orderId: existingLive.id, diningTableId });
          for (const id of attachMembers.length > 0 ? attachMembers : [diningTableId]) {
            broadcast("table.status_updated", { tableId: id, orderId: existingLive.id, status: "OCCUPIED" });
          }
        }).catch(() => {});
        return res.status(200).json({ ...orderDetail, added, attachedToExisting: true });
      }
    }

    const orderType = (body.orderType === "TAKEAWAY" || body.orderType === "PICKUP") ? "PICKUP" : (body.orderType === "DELIVERY" ? "DELIVERY" : "DINE_IN");
    const idempotencyKey = body.idempotencyKey || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const input: CreateOrderInput = {
      outletId,
      terminalNumber: body.terminalNumber || "POS-01",
      orderType: orderType as any,
      idempotencyKey,
      lines,
      diningTableId: isHold ? undefined : diningTableId,
      customerId: body.customerId || undefined,
      waiterId: body.waiterId || undefined,
    };

    const result = await createOrder(input, menuPriceLookup, orderRepo, modifierPriceLookup);

    if (diningTableId || body.tableNumber) {
      await prisma.order.update({
        where: { id: result.id },
        data: {
          diningTableId: diningTableId || undefined,
          table_number: body.tableNumber ? String(body.tableNumber) : undefined,
        },
      }).catch(() => {});
    }

    if (body.scheduledFireAt) {
      await prisma.order.update({
        where: { id: result.id },
        data: {
          scheduledFireAt: new Date(body.scheduledFireAt),
          promisedAt: body.promisedAt ? new Date(body.promisedAt) : undefined,
          depositMinor: body.depositMinor != null ? BigInt(body.depositMinor) : undefined,
          advanceStatus: "SCHEDULED",
        },
      }).catch(() => undefined);
    }

    if (isHold) {
      await prisma.order.update({
        where: { id: result.id },
        data: {
          advanceStatus: "HELD",
          diningTableId: diningTableId || undefined,
          table_number: body.tableNumber ? String(body.tableNumber) : undefined,
        },
      });
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'orders.ts:POST HOLD',message:'held draft created',data:{orderId:result.id,diningTableId:diningTableId||null,lineCount:lines.length,occupied:false},timestamp:Date.now(),runId:'wave3'})}).catch(()=>{});
      // #endregion
    }
    // If KOT creation requested (action: "KOT" or status: "ACTIVE" or "KOT_CREATED"):
    else if (body.action === "KOT" || body.status === "ACTIVE" || body.status === "KOT_CREATED") {
      if (!body.scheduledFireAt) {
        await transitionOrder(result.id, "CONFIRMED", orderRepo, req.auth!.userId);
        await transitionOrder(result.id, "KOT_CREATED", orderRepo, req.auth!.userId);
        await onOrderConfirmed(result.id, prisma);
      }

      if (diningTableId) {
        await occupyMergeMembers(prisma, outletId, diningTableId);
        await stampOrderMergeLabel(prisma, outletId, result.id, diningTableId);
      }
      // #region agent log
      fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'W1',location:'orders.ts:POST KOT',message:'waiter/pos KOT created and table occupied',data:{orderId:result.id,orderNumber:result.orderNumber||null,diningTableId:diningTableId||null,tableNumber:body.tableNumber||null,lineCount:lines.length,action:body.action||null,status:body.status||null},timestamp:Date.now(),runId:'waiter-e2e'})}).catch(()=>{});
      // #endregion
    }
    // If Bill / Immediate Settlement requested (action: "BILL" or isPaid: true or status: "COMPLETED"):
    else if (body.action === "BILL" || body.isPaid || body.status === "COMPLETED") {
      await transitionOrder(result.id, "CONFIRMED", orderRepo, req.auth!.userId);
      await onOrderConfirmed(result.id, prisma);
      const billed = await settleOrderCommand(prisma, {
        outletId,
        orderId: result.id,
        userId: req.auth!.userId,
        paymentMethod: body.paymentMethod,
        amountPaidMinor: body.amountPaidMinor,
        payments: body.payments,
        customerId: body.customerId,
      });
      (result as any).invoiceNumber = billed.invoiceNumber;
      (result as any).invoiceNumbers = billed.invoiceNumbers;
    }

    const orderDetail = await getOrderDetail(outletId, result.id, orderRepo);
    const createMembers = diningTableId
      ? await expandMergeMemberIds(prisma, outletId, [diningTableId])
      : [];

    import("../websockets").then(({ broadcast }) => {
      broadcast("order.created", {
        orderId: result.id,
        orderNumber: orderDetail?.orderNumber || "NEW",
        tableId: isHold ? null : diningTableId,
        status: orderDetail?.status || result.status,
      });
      if (!isHold) {
        broadcast("kot.created", { orderId: result.id, diningTableId });
        const occupyIds = createMembers.length > 0 ? createMembers : (diningTableId ? [diningTableId] : []);
        for (const id of occupyIds) {
          broadcast("table.status_updated", {
            tableId: id,
            orderId: result.id,
            status: body.action === "BILL" ? "AVAILABLE" : "OCCUPIED",
            stage: body.action === "KOT" ? "QUEUED" : undefined,
          });
        }
      }
    }).catch(() => {});

    res.status(201).json({
      ...result,
      id: result.id,
      orderNumber: orderDetail?.orderNumber || "NEW",
      status: orderDetail?.status || result.status,
      grandTotalMinor: orderDetail ? String(orderDetail.grandTotalMinor) : "0",
      taxTotalMinor: orderDetail ? String(orderDetail.taxTotalMinor) : "0",
      subtotalMinor: orderDetail ? String(orderDetail.subtotalMinor) : "0",
      diningTableId,
      items: orderDetail?.items || [],
      invoiceNumber: (result as any).invoiceNumber || undefined,
      invoiceNumbers: (result as any).invoiceNumbers || undefined,
    });
  } catch (err: any) {
    console.error("Error creating order:", err);
    if (err.message && err.message.includes("Idempotency conflict")) {
      return res.status(409).json({ error: err.message });
    }
    res.status(400).json({ error: err.message || "Failed to create order" });
  }
});

// GET /orders/advance - List scheduled advance / future orders
ordersRouter.get("/orders/advance", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const advanceOrders = await prisma.order.findMany({
      where: {
        outletId,
        OR: [
          { scheduledFireAt: { not: null } },
          { advanceStatus: { not: null } },
        ],
      },
      include: {
        orderItems: true,
        diningTable: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(advanceOrders);
  } catch (err) {
    console.error("Error fetching advance orders:", err);
    res.status(500).json({ error: "Failed to fetch advance orders" });
  }
});

// GET /orders/live - Get all active/live orders in preparation or on tables
ordersRouter.get("/orders/live", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const activeOrders = await prisma.order.findMany({
      where: {
        outletId,
        status: { in: ["DRAFT", "PLACED", "CONFIRMED", "KOT_CREATED", "IN_PREPARATION", "READY", "SERVED", "HANDED_OVER", "OUT_FOR_DELIVERY"] },
        NOT: { advanceStatus: "HELD" },
      },
      include: {
        orderItems: true,
        diningTable: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(activeOrders);
  } catch (err) {
    console.error("Error fetching live orders:", err);
    res.status(500).json({ error: "Failed to fetch live orders" });
  }
});

ordersRouter.get("/orders/held", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const held = await prisma.order.findMany({
      where: {
        outletId,
        advanceStatus: "HELD",
        status: { in: ["DRAFT", "PLACED"] },
      },
      include: {
        orderItems: true,
        diningTable: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const payload = held.map((ord) => {
      const items = (ord.orderItems || []).filter((i) => !i.isVoided);
      return {
        id: ord.id,
        orderNumber: ord.orderNumber,
        tableNumber: ord.table_number || ord.diningTable?.tableNumber || "",
        diningTableId: ord.diningTableId,
        orderType: ord.orderType,
        status: ord.status,
        advanceStatus: ord.advanceStatus,
        itemCount: items.reduce((sum, i) => sum + Number(i.quantity || 0), 0),
        totalMinor: Number(ord.grandTotal || 0),
        heldAt: ord.updatedAt || ord.createdAt,
        items: items.map((i) => ({
          id: i.id,
          menuItemId: i.menuItemId,
          name: i.item_name,
          quantity: Number(i.quantity || 0),
          unitPriceMinor: Number(i.unitPrice || 0),
          notes: i.notes,
        })),
      };
    });
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'orders.ts:GET /held',message:'held list',data:{count:payload.length},timestamp:Date.now(),runId:'wave3'})}).catch(()=>{});
    // #endregion
    res.status(200).json(payload);
  } catch (err) {
    console.error("Error fetching held orders:", err);
    res.status(500).json({ error: "Failed to fetch held orders" });
  }
});

// GET /orders/:id - Get order detail
ordersRouter.get("/orders/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const orderId = req.params.id;
    const order = await getOrderDetail(outletId, orderId, orderRepo);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const payments = await prisma.payment.findMany({
      where: { orderId: order.id, outletId },
      orderBy: { createdAt: "asc" },
    }).catch(() => []);

    const kotTickets = await prisma.kOTTicket.findMany({
      where: { orderId: order.id },
      include: { kotItems: true },
    }).catch(() => []);
    const kitchenRank: Record<string, number> = {
      QUEUED: 1, KOT_CREATED: 1, PENDING: 1,
      PREPARING: 2, COOKING: 2, IN_PREPARATION: 2,
      READY: 3, SERVED: 4,
    };
    const kitchenByOrderItem = new Map<string, string>();
    for (const ticket of kotTickets) {
      for (const ki of ticket.kotItems || []) {
        if (!ki.orderItemId) continue;
        const prev = kitchenByOrderItem.get(ki.orderItemId);
        const next = ticket.status;
        if (!prev || (kitchenRank[next] || 0) >= (kitchenRank[prev] || 0)) {
          kitchenByOrderItem.set(ki.orderItemId, next);
        }
      }
    }


    const extra = await prisma.order.findFirst({
      where: { id: order.id, outletId },
      select: { advanceStatus: true, table_number: true },
    }).catch(() => null);

    res.status(200).json({
      ...order,
      advanceStatus: extra?.advanceStatus || null,
      tableNumber: extra?.table_number || null,
      grandTotalMinor: String(order.grandTotalMinor),
      subtotalMinor: String(order.subtotalMinor),
      taxTotalMinor: String(order.taxTotalMinor),
      discountTotalMinor: String(order.discountTotalMinor),
      paymentMethod: order.paymentMethod || (payments[0]?.method ?? null),
      items: (order.items || []).map((it: any) => ({
        ...it,
        unitPriceMinor: String(it.unitPriceMinor),
        subtotalMinor: String(it.subtotalMinor),
        kitchenStatus: kitchenByOrderItem.get(it.id) || null,
      })),
      payments: (payments.length > 0 ? payments : (order.payments || [])).map((p: any) => ({
        id: p.id,
        amountMinor: String(p.amount ?? p.amountMinor ?? "0"),
        method: p.method,
        status: p.status,
        transactionId: p.transaction_id || p.transactionId || p.id,
        createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
      })),
    });
  } catch (err: any) {
    console.error("Error fetching order detail:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// PATCH /orders/:id/status - Status transition
ordersRouter.patch("/orders/:id/status", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.auth!.userId;
    const targetStatus = (req.body.toStatus || req.body.status) as OrderStatus;
    const { reasonCode, approverUserId } = req.body;

    if (!targetStatus) {
      return res.status(400).json({ error: "status or toStatus is required" });
    }

    const orderId = req.params.id;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Auto-progress prerequisite steps if skipping
    const cur = order.status;
    if (cur === "PLACED" && (targetStatus === "IN_PREPARATION" || (targetStatus as any) === "PREPARING" || targetStatus === "READY")) {
      await transitionOrder(orderId, "CONFIRMED", orderRepo, userId).catch(() => {});
      await transitionOrder(orderId, "KOT_CREATED", orderRepo, userId).catch(() => {});
    }

    const mappedTarget = targetStatus === ("PREPARING" as any) ? "IN_PREPARATION" : targetStatus;
    const result = await transitionOrder(
      orderId,
      mappedTarget as OrderStatus,
      orderRepo,
      userId,
      reasonCode,
      approverUserId
    );

    if (mappedTarget === "CONFIRMED" || mappedTarget === "KOT_CREATED") {
      await onOrderConfirmed(orderId, prisma).catch(() => {});
    }

    if (mappedTarget === "COMPLETED") {
      if (order.diningTableId) {
        await dissolveMergeGroupForTable(prisma, order.outletId, order.diningTableId).catch(() => {});
      }
    }

    res.status(200).json(result);
  } catch (err: any) {
    console.error("Error updating order status:", err);
    res.status(400).json({ error: err.message || "Failed to transition order status" });
  }
});

// GET /orders/:id/bill - Get bill summary
ordersRouter.get("/orders/:id/bill", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const bill = await orderRepo.getBill(outletId, req.params.id);
    if (!bill) {
      return res.status(404).json({ error: "Order or bill not found" });
    }
    res.status(200).json({
      orderId: bill.orderId,
      orderNumber: bill.orderNumber,
      subtotalMinor: bill.subtotalMinor.toString(),
      discountTotalMinor: bill.discountTotalMinor.toString(),
      taxTotalMinor: bill.taxTotalMinor.toString(),
      tipTotalMinor: bill.tipTotalMinor.toString(),
      serviceChargeTotalMinor: bill.serviceChargeTotalMinor.toString(),
      grandTotalMinor: bill.grandTotalMinor.toString(),
      paidMinor: bill.paidMinor.toString(),
      dueMinor: bill.dueMinor.toString(),
    });
  } catch (err: any) {
    console.error("Error fetching bill:", err);
    res.status(500).json({ error: err.message || "Failed to fetch bill" });
  }
});

// POST /orders/:id/payments & POST /orders/:id/settle - Record payment and settle order
const handleRecordPayment = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const amountMinor = req.body.amountMinor || req.body.amountPaidMinor || req.body.amount;
    const method = req.body.method || req.body.paymentMethod || "CASH";
    const seatNumber = req.body.seatNumber;

    if (!amountMinor) {
      return res.status(400).json({ error: "amountMinor is required" });
    }

    const payment = await orderRepo.recordPayment(
      outletId,
      req.params.id,
      BigInt(amountMinor),
      method,
      userId,
      seatNumber
    );

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
    });

    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'orders.ts:handleRecordPayment',message:'POST /payments after recordPayment',data:{orderId:req.params.id,method,amount:String(amountMinor),orderStatus:order?.status||null,settledAt:order?.settledAt?true:false,tableNumber:order?.table_number||null},timestamp:Date.now(),runId:'hotel-p0'})}).catch(()=>{});
    // #endregion

    res.status(201).json({
      ...payment,
      amountMinor: payment.amountMinor.toString(),
      paymentMethod: method,
      orderStatus: order?.status,
      success: true,
    });
  } catch (err: any) {
    console.error("Error recording payment:", err);
    res.status(400).json({ error: err.message || "Failed to record payment" });
  }
};

ordersRouter.post("/orders/:id/payments", requireAuth, handleRecordPayment);

// POST /orders/:id/items - Add items to existing running order
ordersRouter.post("/orders/:id/items", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const { lines } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "lines must be a non-empty array" });
    }

    const added = await addOrderItems(
      outletId,
      req.params.id,
      lines,
      menuPriceLookup,
      orderRepo,
      userId,
      modifierPriceLookup
    );
    await onItemsAdded(req.params.id, prisma).catch(() => {});
    const live = await prisma.order.findFirst({
      where: { id: req.params.id, outletId },
      select: { id: true, diningTableId: true, table_number: true },
    });
    if (live?.diningTableId) {
      await occupyMergeMembers(prisma, outletId, live.diningTableId);
      await stampOrderMergeLabel(prisma, outletId, live.id, live.diningTableId);
    }
    const itemMembers = live?.diningTableId
      ? await expandMergeMemberIds(prisma, outletId, [live.diningTableId])
      : [];
    import("../websockets").then(({ broadcast }) => {
      broadcast("order.updated", { orderId: req.params.id, diningTableId: live?.diningTableId || null });
      broadcast("kot.created", { orderId: req.params.id, diningTableId: live?.diningTableId || null });
      for (const id of itemMembers) {
        broadcast("table.status_updated", { tableId: id, orderId: req.params.id, status: "OCCUPIED" });
      }
    }).catch(() => {});
    res.status(200).json(added);
  } catch (err: any) {
    console.error("Error adding items to order:", err);
    res.status(400).json({ error: err.message || "Failed to add items" });
  }
});

// POST & PATCH /orders/:id/items/:itemId/void - Void an item from order
const handleVoidItem = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const reasonCode = req.body?.reasonCode || req.body?.reason || "CUSTOMER_VOID";

    const result = await orderRepo.voidItem(
      outletId,
      req.params.id,
      req.params.itemId,
      reasonCode,
      userId
    );
    if (!result.ok) {
      return res.status(404).json({ error: "Item not found or already voided" });
    }
    res.status(200).json(result);
  } catch (err: any) {
    console.error("Error voiding order item:", err);
    res.status(400).json({ error: err.message || "Failed to void item" });
  }
};

ordersRouter.post("/orders/:id/items/:itemId/void", requireAuth, handleVoidItem);
ordersRouter.patch("/orders/:id/items/:itemId/void", requireAuth, handleVoidItem);

// POST & PATCH /orders/:id/charges - Apply discounts / tips / service charges
const handleCharges = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const { tipMinor, serviceChargeMinor } = req.body;

    const updated = await orderRepo.setCharges(
      outletId,
      req.params.id,
      BigInt(tipMinor || 0),
      BigInt(serviceChargeMinor || 0)
    );
    res.status(200).json({
      ...updated,
      tipTotalMinor: updated.tipTotalMinor.toString(),
      serviceChargeTotalMinor: updated.serviceChargeTotalMinor.toString(),
      grandTotalMinor: updated.grandTotalMinor.toString(),
    });
  } catch (err: any) {
    console.error("Error applying charges:", err);
    res.status(400).json({ error: err.message || "Failed to apply charges" });
  }
};

ordersRouter.post("/orders/:id/charges", requireAuth, handleCharges);
ordersRouter.patch("/orders/:id/charges", requireAuth, handleCharges);

// POST /orders/:id/settle - Settle and complete order with payment.
// Cashiers use bill.settle. Captains with order.create may settle a table they collected payment on.
ordersRouter.post("/orders/:id/settle", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const settlePerm = await checkPermissionDirect(req.auth!.userId, req.auth!.outletId, "bill.settle");
    const createPerm = await checkPermissionDirect(req.auth!.userId, req.auth!.outletId, "order.create");
    if (!settlePerm.allowed && !createPerm.allowed) {
      return res.status(403).json({ error: settlePerm.reason || "not allowed to settle" });
    }
    const result = await settleOrderCommand(prisma, {
      outletId: req.auth!.outletId,
      orderId: req.params.id,
      userId: req.auth!.userId,
      paymentMethod: req.body.paymentMethod,
      amountPaidMinor: req.body.amountPaidMinor,
      payments: req.body.payments,
      customerId: req.body.customerId,
    });
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'orders.ts:POST /settle',message:'settle response',data:{orderId:req.params.id,alreadySettled:result.alreadySettled,status:result.status,invoiceNumber:result.invoiceNumber,invoiceNumbers:result.invoiceNumbers},timestamp:Date.now(),runId:'split-post'})}).catch(()=>{});
    // #endregion
    res.status(200).json(result);
  } catch (err: any) {
    if (err?.message === "ALREADY_SETTLED" || err?.code === "ALREADY_SETTLED") {
      return res.status(409).json({ error: "Order already settled", code: "ALREADY_SETTLED" });
    }
    console.error("Error settling order:", err);
    res.status(500).json({ error: err.message || "Failed to settle order" });
  }
});

ordersRouter.post("/orders/:id/hold", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, outletId: req.auth!.outletId },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "DRAFT" && order.status !== "PLACED") {
      return res.status(409).json({ error: "Only DRAFT or PLACED orders can be held" });
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { advanceStatus: "HELD" },
    });
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'orders.ts:POST /hold',message:'order parked',data:{orderId:updated.id,fromStatus:order.status},timestamp:Date.now(),runId:'wave3'})}).catch(()=>{});
    // #endregion
    res.status(200).json({ ok: true, orderId: updated.id, status: updated.status, advanceStatus: updated.advanceStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to hold order" });
  }
});

// POST /orders/:id/fire-advance - Dispatch a scheduled advance order to Kitchen KDS
ordersRouter.post("/orders/:id/fire-advance", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const orderId = req.params.id;

    const existing = await prisma.order.findFirst({
      where: { id: orderId, outletId },
    });
    if (!existing) return res.status(404).json({ error: "Order not found" });
    await prisma.order.update({
      where: { id: orderId },
      data: { advanceStatus: "FIRED" },
    }).catch(() => undefined);
    await transitionOrder(orderId, "CONFIRMED", orderRepo, req.auth!.userId).catch(() => {});
    await transitionOrder(orderId, "KOT_CREATED", orderRepo, req.auth!.userId).catch(() => {});
    await onOrderConfirmed(orderId, prisma);
    if (existing.diningTableId) {
      await occupyMergeMembers(prisma, outletId, existing.diningTableId);
      await stampOrderMergeLabel(prisma, outletId, orderId, existing.diningTableId);
    }

    res.status(200).json({ ok: true, orderId, status: "KOT_CREATED" });
  } catch (err: any) {
    console.error("Error firing advance order:", err);
    res.status(500).json({ error: "Failed to fire advance order to kitchen" });
  }
});

// POST /orders/:id/cancel - Cancel order
ordersRouter.post("/orders/:id/cancel", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.auth!.userId;
    const { reason, reasonCode } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.status === "COMPLETED") {
      return res.status(400).json({ error: "Cannot cancel a completed order. Use refund instead." });
    }

    if (order.status === "CANCELLED") {
      return res.status(400).json({ error: "Order is already cancelled." });
    }

    await transitionOrder(orderId, "CANCELLED" as OrderStatus, orderRepo, userId, reason || reasonCode || "CUSTOMER_CANCELLED");

    const kotCancel = await prisma.kOTTicket.updateMany({
      where: { orderId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'L1',location:'orders.ts:cancel',message:'cancel also voids KOT tickets',data:{orderId,kotsCancelled:kotCancel.count},timestamp:Date.now(),runId:'tax-fix'})}).catch(()=>{});
    // #endregion

    const dissolved = order.diningTableId
      ? await dissolveMergeGroupForTable(prisma, order.outletId, order.diningTableId)
      : { ids: [] as string[] };

    import("../websockets").then(({ broadcast }) => {
      broadcast("order.status_updated", { orderId, status: "CANCELLED", tableId: order.diningTableId });
      for (const id of dissolved.ids.length > 0 ? dissolved.ids : order.diningTableId ? [order.diningTableId] : []) {
        broadcast("table.status_updated", { tableId: id, orderId, status: "VACANT" });
      }
    }).catch(() => {});

    res.status(200).json({ ok: true, orderId, status: "CANCELLED", reason: reason || reasonCode || "CUSTOMER_CANCELLED" });
  } catch (err: any) {
    console.error("Error cancelling order:", err);
    res.status(500).json({ error: err.message || "Failed to cancel order" });
  }
});

// GET /orders/by-table/:tableId/active - Get running order on a table
ordersRouter.get("/orders/by-table/:tableId/active", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const tableId = req.params.tableId;
    const anchor = await resolveAnchorTable(prisma, outletId, tableId);
    const memberIds = await expandMergeMemberIds(prisma, outletId, [anchor?.id || tableId]);
    const liveOrders = await findLiveOrdersOnTables(
      prisma,
      outletId,
      memberIds.length > 0 ? memberIds : [anchor?.id || tableId]
    );
    const order = liveOrders[0];

    if (!order) {
      return res.status(404).json({ error: "No active order for this table" });
    }

    res.status(200).json({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      grandTotalMinor: order.grandTotal.toString(),
      subtotalMinor: order.subtotal.toString(),
      taxTotalMinor: (order.taxTotal || 0n).toString(),
      items: (order.orderItems || []).map((item: any) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        menuItemName: item.item_name || "Dish",
        quantity: item.quantity,
        unitPriceMinor: item.unitPrice.toString(),
        subtotalMinor: item.subtotal.toString(),
        notes: item.notes,
        isVoided: item.is_voided ?? item.isVoided,
        course: item.course,
        seatNumber: item.seat_number ?? item.seatNumber,
      })),
    });
  } catch (err: any) {
    console.error("Error fetching active table order:", err);
    res.status(500).json({ error: err.message || "Failed to fetch active table order" });
  }
});

// GET /orders/:id/bill/by-seat - Group item totals and paid amounts by seat number
ordersRouter.get("/orders/:id/bill/by-seat", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const orderId = req.params.id;

    const result = await orderRepo.getBillBySeat(outletId, orderId);
    res.status(200).json(result);
  } catch (err: any) {
    console.error("Error generating seat bill:", err);
    res.status(500).json({ error: err.message || "Failed to generate seat bill" });
  }
});
