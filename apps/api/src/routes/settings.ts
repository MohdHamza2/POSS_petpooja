import { Router } from "express";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";
import { loadOutletOpsStatus, saveOutletOpsStatus } from "../outlet-channel-status";

export const settingsRouter = Router();

const toClientStatus = (status: Awaited<ReturnType<typeof loadOutletOpsStatus>>) => ({
  isOnline: status.isOnline,
  dineInActive: status.dineInActive,
  deliveryActive: status.deliveryActive,
  pickupActive: status.pickupActive,
  updatedAt: status.updatedAt,
});

// GET /settings/outlet-status & GET /settings/store-status
const handleGetOutletStatus = async (req: AuthedRequest, res: any) => {
  try {
    const status = await loadOutletOpsStatus(req.auth!.outletId);
    res.status(200).json(toClientStatus(status));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
};

settingsRouter.get("/settings/outlet-status", requireAuth, handleGetOutletStatus);
settingsRouter.get("/settings/store-status", requireAuth, handleGetOutletStatus);

// POST & PATCH /settings/outlet-status & /settings/store-status
const handleUpdateOutletStatus = async (req: AuthedRequest, res: any) => {
  const rawOnline = req.body.isOnline ?? req.body.isOpen ?? req.body.active;
  const patch: {
    isOnline?: boolean;
    dineInActive?: boolean;
    deliveryActive?: boolean;
    pickupActive?: boolean;
  } = {};
  if (typeof rawOnline === "boolean") patch.isOnline = rawOnline;
  if (typeof req.body.dineInActive === "boolean") patch.dineInActive = req.body.dineInActive;
  if (typeof req.body.deliveryActive === "boolean") patch.deliveryActive = req.body.deliveryActive;
  if (typeof req.body.pickupActive === "boolean") patch.pickupActive = req.body.pickupActive;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "isOnline or a channel flag must be boolean" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;
    const status = await saveOutletOpsStatus(outletId, userId, patch);

    import("../websockets").then(({ broadcast }) => {
      broadcast("outlet.store_status_updated", {
        outletId,
        isOnline: status.isOnline,
        dineInActive: status.dineInActive,
        deliveryActive: status.deliveryActive,
        pickupActive: status.pickupActive,
      });
    }).catch(err => console.error('Background task error:', err?.message || err));

    res.status(200).json(toClientStatus(status));
    // #region agent log
    fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'S4',location:'settings.ts:store-status',message:'store/channel pause written',data:{isOnline:status.isOnline,dineInActive:status.dineInActive,deliveryActive:status.deliveryActive,pickupActive:status.pickupActive,patch,gated:'integration.manage'},timestamp:Date.now(),runId:'sec-auth'})}).catch(()=>{});
    // #endregion
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
};

settingsRouter.post("/settings/outlet-status", requireAuth, requirePermission("integration.manage"), handleUpdateOutletStatus);
settingsRouter.patch("/settings/outlet-status", requireAuth, requirePermission("integration.manage"), handleUpdateOutletStatus);
settingsRouter.post("/settings/store-status", requireAuth, requirePermission("integration.manage"), handleUpdateOutletStatus);
settingsRouter.patch("/settings/store-status", requireAuth, requirePermission("integration.manage"), handleUpdateOutletStatus);

settingsRouter.get("/settings/outlet", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) return res.status(404).json({ error: "Outlet not found" });
    const organization = await prisma.organization.findUnique({
      where: { id: outlet.organizationId },
    });
    res.status(200).json({
      id: outlet.id,
      code: outlet.code,
      name: outlet.name,
      loyaltyPaisePerPoint: outlet.loyaltyPaisePerPoint != null ? outlet.loyaltyPaisePerPoint.toString() : null,
      taxNumber: organization?.tax_id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

settingsRouter.patch("/settings/outlet", requireAuth, requirePermission("crm.write"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) return res.status(404).json({ error: "Outlet not found" });

    const data: { loyaltyPaisePerPoint?: bigint | null } = {};
    if (req.body.loyaltyPaisePerPoint !== undefined) {
      if (req.body.loyaltyPaisePerPoint === null || req.body.loyaltyPaisePerPoint === "") {
        data.loyaltyPaisePerPoint = null;
      } else {
        const n = BigInt(req.body.loyaltyPaisePerPoint);
        if (n < 0n) return res.status(400).json({ error: "loyaltyPaisePerPoint must be >= 0" });
        data.loyaltyPaisePerPoint = n;
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.outlet.update({ where: { id: outletId }, data });
    }

    if (req.body.taxNumber !== undefined) {
      const taxNumber = typeof req.body.taxNumber === "string" ? req.body.taxNumber.trim() : "";
      await prisma.organization.update({
        where: { id: outlet.organizationId },
        data: { tax_id: taxNumber || null },
      });
    }

    const updated = await prisma.outlet.findUnique({ where: { id: outletId } });
    const organization = await prisma.organization.findUnique({
      where: { id: outlet.organizationId },
    });
    res.status(200).json({
      id: updated!.id,
      code: updated!.code,
      name: updated!.name,
      loyaltyPaisePerPoint: updated!.loyaltyPaisePerPoint != null ? updated!.loyaltyPaisePerPoint.toString() : null,
      taxNumber: organization?.tax_id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

