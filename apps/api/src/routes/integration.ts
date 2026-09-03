import { Router } from "express";
import { requireAuth, requirePermission, AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";
import { encryptCredential, maskCredential } from "@kapmeta/integration";
import { channelPausedReason, loadOutletOpsStatus } from "../outlet-channel-status";

const router = Router();

/** Same inclusive GST back-out as services/orders priceOrder. Menu prices are tax-in. */
function extractInclusiveTaxMinor(subtotalMinor: bigint, taxRatePercent: number): bigint {
  const rate = Number(taxRatePercent ?? 0);
  if (subtotalMinor <= 0n || !Number.isFinite(rate) || rate <= 0) return 0n;
  const taxRateBasisPoints = BigInt(Math.round(rate * 100));
  return subtotalMinor - (subtotalMinor * 10000n) / (10000n + taxRateBasisPoints);
}

async function resolveWebhookCustomer(outletId: string, customer: { name?: string; phone?: string } | null | undefined): Promise<string | null> {
  const phone = String(customer?.phone || "").replace(/\s+/g, "").trim();
  const name = String(customer?.name || "").trim();
  if (phone.length < 8) return null;
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { organizationId: true },
  });
  const organizationId = outlet?.organizationId || null;
  const existing = await prisma.customer.findFirst({
    where: organizationId
      ? { organization_id: organizationId, phone }
      : { outletId, phone },
  });
  if (existing) return existing.id;
  const parts = (name || "Guest").split(/\s+/).filter(Boolean);
  const created = await prisma.customer.create({
    data: {
      organization_id: organizationId || undefined,
      outletId,
      phone,
      firstName: parts[0] || "Guest",
      lastName: parts.slice(1).join(" ") || undefined,
      name: name || parts[0] || "Guest",
      isActive: true,
    },
  });
  await (prisma as any).loyalty_accounts.create({
    data: {
      customer_id: created.id,
      balance: 0,
      tier: "SILVER",
    },
  }).catch((err: any) => console.error('Background task error:', err?.message || err));
  return created.id;
}

// =====================================
// CHANNEL MAPPING MANAGEMENT
// =====================================

// Create a new channel account mapping (No Hardcoding Rule)
router.post(["/channels", "/integrations/channels", "/integration/channels", "/integration/integrations/channels"], requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    const { channel, externalOutletId, credentialsRef } = req.body;

    const account = await prisma.channelAccount.create({
      data: {
        outletId: req.auth!.outletId,
        integration_id: req.auth!.outletId,
        channel,
        externalOutletId,
        credentialsRef,
        is_active: true,
      } as any
    });

    res.status(201).json(account);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// "Easy connect" flow — list all delivery-app connections for this outlet.
router.get(["/channels", "/integrations/channels", "/integration/channels", "/integration/integrations/channels"], requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    const accounts = await prisma.channelAccount.findMany({
      where: { outletId: req.auth!.outletId },
    });
    res.status(200).json(
      accounts.map((a: any) => ({
        id: a.id,
        channel: a.channel || a.credentialsRef || "SWIGGY",
        externalOutletId: a.externalOutletId || "EXT-001",
        status: a.is_active ? "ACTIVE" : "PAUSED",
        connectedAt: a.createdAt,
        hasCredentials: true,
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Connect (or update) one channel's credentials.
router.put(["/channels/:channel/connect", "/integrations/channels/:channel/connect", "/integration/integrations/channels/:channel/connect"], requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    const channel = req.params.channel.toUpperCase();
    if (!["SWIGGY", "ZOMATO"].includes(channel)) {
      res.status(400).json({ error: "unsupported channel — only SWIGGY and ZOMATO have adapters today" });
      return;
    }
    const { externalOutletId, apiKey, apiSecret } = req.body;
    if (!externalOutletId || !apiKey || !apiSecret) {
      res.status(400).json({ error: "externalOutletId, apiKey, apiSecret required" });
      return;
    }

    const outletId = req.auth!.outletId;
    const account = await prisma.channelAccount.create({
      data: {
        outletId,
        integration_id: outletId,
        externalOutletId,
        credentialsRef: channel,
        is_active: true,
      } as any
    });

    res.status(200).json({
      id: account.id,
      channel,
      externalOutletId: account.externalOutletId,
      status: "ACTIVE",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect channel
router.post(["/channels/:accountId/disconnect", "/integrations/channels/:accountId/disconnect", "/integration/integrations/channels/:accountId/disconnect"], requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    await prisma.channelAccount.updateMany({
      where: { id: req.params.accountId, outletId: req.auth!.outletId },
      data: { is_active: false } as any,
    });
    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create item mappings for a channel
router.post("/integrations/mappings", requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    const { channelAccountId, mappings } = req.body; 
    // mappings: Array<{ menuItemId, externalItemId, channelPrice }>

    const results = await Promise.all(
      mappings.map(async (m: any) => {
        const existing = await (prisma as any).channelItemMapping.findFirst({
          where: {
            channelAccountId,
            externalItemId: m.externalItemId,
          },
        });
        if (existing) {
          return await (prisma as any).channelItemMapping.update({
            where: { id: existing.id },
            data: {
              item_id: m.menuItemId || m.item_id,
            },
          });
        } else {
          return await (prisma as any).channelItemMapping.create({
            data: {
              channelAccountId,
              item_id: m.menuItemId || m.item_id,
              externalItemId: m.externalItemId,
            },
          });
        }
      })
    );

    res.status(201).json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================
// PER-CHANNEL ITEM AVAILABILITY (Online Item Status)
// =====================================

router.get(["/channel-items", "/integration/channel-items"], requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const channelAccounts = await prisma.channelAccount.findMany({
      where: { outletId, is_active: true },
    });

    const menuItems = await prisma.menuItem.findMany({
      where: { outletId },
      include: { category: true },
    });

    const availabilityRows = await prisma.item_availability.findMany({
      where: { outlet_id: outletId },
    });
    const availByKey = new Map(
      availabilityRows.map((row) => [`${row.channel_id}_${row.item_id}`, row])
    );
    const availByItem = new Map<string, (typeof availabilityRows)[number]>();
    for (const row of availabilityRows) {
      const prev = availByItem.get(row.item_id);
      if (!prev || row.version >= prev.version) availByItem.set(row.item_id, row);
    }

    const channelsToShow =
      channelAccounts.length > 0
        ? channelAccounts
        : [{ id: outletId, credentialsRef: "POS" } as (typeof channelAccounts)[number] & { credentialsRef: string }];

    const items = menuItems.map((item) => {
      const itemRow = availByItem.get(item.id);
      const itemStocked = itemRow ? itemRow.state !== "OFF" : item.isActive !== false;
      const channels = channelsToShow.map((acc) => {
        const row = availByKey.get(`${acc.id}_${item.id}`);
        const isAvailable = row ? row.state !== "OFF" : itemStocked;
        return {
          mappingId: row?.id || `${acc.id}:${item.id}`,
          channelAccountId: acc.id,
          channel: (acc as { credentialsRef?: string }).credentialsRef || "CHANNEL",
          menuItemId: item.id,
          isAvailable,
          version: row?.version ?? itemRow?.version ?? 1,
        };
      });

      const overallStatus =
        channels.length === 0
          ? itemStocked
            ? "ALL_ON"
            : "ALL_OFF"
          : channels.every((c) => c.isAvailable)
          ? "ALL_ON"
          : channels.every((c) => !c.isAvailable)
          ? "ALL_OFF"
          : "PARTIAL";

      return {
        menuItemId: item.id,
        name: item.name,
        onlineDisplayName: item.name,
        categoryName: item.category?.name || "General",
        overallStatus,
        channels,
      };
    });

    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'A',location:'integration.ts:GET channel-items',message:'channel 86 vs item_availability',data:{menuCount:menuItems.length,channelAccountCount:channelAccounts.length,offCount:items.filter((i)=>i.overallStatus==='ALL_OFF').length,onCount:items.filter((i)=>i.overallStatus==='ALL_ON').length,syntheticPos:channelAccounts.length===0},timestamp:Date.now(),runId:'86-post'})}).catch(()=>{});
    // #endregion
    res.status(200).json(items);
  } catch (err: any) {
    console.error("Error fetching channel items:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch(["/channel-items/:mappingId/availability", "/integration/channel-items/:mappingId/availability"], requireAuth, requirePermission("integration.manage"), async (req: AuthedRequest, res) => {
  try {
    const { isAvailable } = req.body;
    const mappingId = req.params.mappingId;
    const outletId = req.auth!.outletId;
    const nextState = isAvailable === false ? "OFF" : "ON";

    let existing = await prisma.item_availability.findUnique({ where: { id: mappingId } }).catch(() => null);
    if (!existing && mappingId.includes(":")) {
      const [channelId, itemId] = mappingId.split(":");
      existing = await prisma.item_availability.findFirst({
        where: { outlet_id: outletId, channel_id: channelId, item_id: itemId },
      });
      if (!existing && channelId && itemId) {
        const created = await prisma.item_availability.create({
          data: {
            outlet_id: outletId,
            channel_id: channelId,
            item_id: itemId,
            state: nextState,
            version: 1,
            updated_by: req.auth!.userId,
          },
        });
        return res.status(200).json({ newVersion: created.version, isAvailable: created.state !== "OFF", mappingId: created.id });
      }
    }

    if (!existing || existing.outlet_id !== outletId) {
      res.status(404).json({ error: "mapping not found" });
      return;
    }

    const updated = await prisma.item_availability.update({
      where: { id: existing.id },
      data: {
        state: nextState,
        version: { increment: 1 },
        updated_at: new Date(),
        updated_by: req.auth!.userId,
      },
    });

    res.status(200).json({ newVersion: updated.version, isAvailable: updated.state !== "OFF", mappingId: updated.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================
// INBOUND AGGREGATOR WEBHOOK INGESTION
// =====================================

router.post(["/webhooks/:channel", "/webhooks/swiggy", "/webhooks/zomato"], async (req, res) => {
  try {
    const channelParam = (req.params.channel || (req.path.includes("swiggy") ? "SWIGGY" : "ZOMATO")).toUpperCase();
    const { externalOrderId, externalEventId, customer, items } = req.body;

    if (!externalOrderId) {
      res.status(400).json({ error: "externalOrderId is required" });
      return;
    }

    const orderNumber = `${channelParam}-${externalOrderId}`;

    // 1. Idempotency Check (Prevent duplicate ingestion on webhook replay)
    const existingOrder = await prisma.order.findFirst({
      where: {
        orderNumber,
      },
    });

    if (existingOrder) {
      res.status(200).json({
        ok: true,
        status: "ALREADY_PROCESSED",
        message: "Webhook event already processed idempotently",
        orderId: existingOrder.id,
        externalOrderId,
      });
      return;
    }

    // 2. Resolve target outlet
    const targetOutlet = req.body.outletId
      ? await prisma.outlet.findUnique({ where: { id: req.body.outletId } })
      : await prisma.outlet.findFirst();

    if (!targetOutlet) {
      res.status(404).json({ error: "Outlet not found" });
      return;
    }

    const outletId = targetOutlet.id;

    const ops = await loadOutletOpsStatus(outletId);
    const pausedReason = channelPausedReason(ops, "DELIVERY");
    const paused = Boolean(pausedReason);
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'CH1',location:'integration.ts:webhook-pause',message:'aggregator ingest pause check',data:{outletId,isOnline:ops.isOnline,deliveryActive:ops.deliveryActive,blocked:paused,reason:pausedReason,externalOrderId},timestamp:Date.now(),runId:'channel-pause'})}).catch(()=>{});
    // #endregion
    if (paused) {
      res.status(409).json({ error: pausedReason, code: "CHANNEL_PAUSED" });
      return;
    }

    // 3. Resolve Menu Items
    const rawItems = Array.isArray(items) ? items : [];
    const outletMenuItems = await prisma.menuItem.findMany({ where: { outletId } });
    const defaultItem = outletMenuItems[0];

    const lines = rawItems.map((it: any) => {
      const matched = outletMenuItems.find(
        (m) => m.name.toLowerCase() === (it.name || "").toLowerCase()
      ) || defaultItem;

      return {
        menuItemId: matched?.id || defaultItem?.id,
        quantity: Number(it.quantity || 1),
        unitPriceMinor: Number(it.priceMinor || (matched ? Number(matched.price) * 100 : 0)),
        name: it.name || matched?.name || "Aggregator Item",
        taxRatePercent: Number(matched?.taxRate ?? defaultItem?.taxRate ?? 0),
      };
    }).filter((l) => l.menuItemId);

    if (lines.length === 0 && defaultItem) {
      lines.push({
        menuItemId: defaultItem.id,
        quantity: 1,
        unitPriceMinor: Number(defaultItem.price) * 100,
        name: defaultItem.name,
        taxRatePercent: Number(defaultItem.taxRate ?? 0),
      });
    }

    let subtotal = 0n;
    let tax = 0n;
    for (const l of lines) {
      const lineSub = BigInt(l.unitPriceMinor) * BigInt(l.quantity);
      subtotal += lineSub;
      tax += extractInclusiveTaxMinor(lineSub, l.taxRatePercent);
    }
    const grandTotal = subtotal;
    const additiveLie = subtotal + (subtotal * 5n) / 100n;
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'T1',location:'integration.ts:webhook-totals',message:'aggregator inclusive totals',data:{subtotal:String(subtotal),tax:String(tax),grandTotal:String(grandTotal),additiveWouldBe:String(additiveLie),lineCount:lines.length,rates:lines.map((l)=>l.taxRatePercent),mode:'inclusive'},timestamp:Date.now(),runId:'tax-fix'})}).catch(()=>{});
    // #endregion
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const customerId = await resolveWebhookCustomer(outletId, customer);
    const tableNumber = "DELIVERY";

    // 4. Create Order & OrderItems
    const createdOrder = await prisma.order.create({
      data: {
        outletId,
        orderNumber,
        orderType: "DELIVERY",
        status: "CONFIRMED",
        business_date: today,
        subtotal,
        taxTotal: tax,
        grandTotal,
        diningTableId: null,
        table_number: tableNumber,
        customerId: customerId || undefined,
        orderItems: {
          create: lines.map((l) => ({
            outletId,
            menuItemId: l.menuItemId,
            item_name: l.name,
            quantity: l.quantity,
            unitPrice: BigInt(l.unitPriceMinor),
            subtotal: BigInt(l.unitPriceMinor) * BigInt(l.quantity),
          })),
        },
      },
    });
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'AG3',location:'integration.ts:webhook-create',message:'aggregator order bound without table',data:{orderId:createdOrder.id,orderNumber:createdOrder.orderNumber,diningTableId:createdOrder.diningTableId,tableNumber:createdOrder.table_number,customerId:createdOrder.customerId,channel:channelParam},timestamp:Date.now(),runId:'agg-post'})}).catch(()=>{});
    // #endregion

    // 5. Generate Station KOTs & Order Status History
    await (prisma.orderStatusHistory as any).create({
      data: {
        orderId: createdOrder.id,
        to_status: "CONFIRMED",
      },
    }).catch((err: any) => console.error('Background task error:', err?.message || err));

    const { onOrderConfirmed, stepOrderTo } = await import("../orchestration/order-lifecycle");
    await stepOrderTo(prisma, createdOrder.id, "KOT_CREATED", outletId);
    await onOrderConfirmed(createdOrder.id, prisma).catch((err: any) => console.error('Background task error:', err?.message || err));

    // 6. Record Immutable Webhook Audit Log
    await prisma.auditLog.create({
      data: {
        outletId,
        actor_id: outletId,
        action: "CREATE",
        entityType: "AGGREGATOR_WEBHOOK",
        entityId: createdOrder.id,
        afterState: {
          channel: channelParam,
          externalOrderId,
          externalEventId: externalEventId || null,
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          customer: customer || null,
        },
        createdAt: new Date(),
      },
    });

    // 7. Broadcast Real-Time WebSocket Alerts
    import("../websockets").then(({ broadcast }) => {
      broadcast("order.created", {
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
        channel: channelParam,
        status: "CONFIRMED",
        grandTotalMinor: String(grandTotal),
      });
      broadcast("kot.created", {
        orderId: createdOrder.id,
        channel: channelParam,
      });
    }).catch((err: any) => console.error('Background task error:', err?.message || err));

    res.status(201).json({
      ok: true,
      orderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      status: "CONFIRMED",
      externalOrderId,
      grandTotalMinor: String(grandTotal),
      taxTotalMinor: String(tax),
    });
  } catch (err: any) {
    console.error("Error processing aggregator webhook:", err);
    res.status(500).json({ error: err.message || "Failed to ingest webhook" });
  }
});

export { router as integrationRouter };

