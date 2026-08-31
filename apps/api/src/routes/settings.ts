import { Router } from "express";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";

export const settingsRouter = Router();

// GET /settings/outlet-status & GET /settings/store-status
const handleGetOutletStatus = async (req: AuthedRequest, res: any) => {
  try {
    const outletId = req.auth!.outletId;
    const status = await (prisma as any).outlet_status.findUnique({
      where: { outlet_id: outletId },
    });

    res.status(200).json({
      isOnline: status?.is_online ?? true,
      updatedAt: status?.updated_at?.toISOString() ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
};

settingsRouter.get("/settings/outlet-status", requireAuth, handleGetOutletStatus);
settingsRouter.get("/settings/store-status", requireAuth, handleGetOutletStatus);

// POST & PATCH /settings/outlet-status & /settings/store-status
const handleUpdateOutletStatus = async (req: AuthedRequest, res: any) => {
  const isOnline = req.body.isOnline ?? req.body.isOpen ?? req.body.active;

  if (typeof isOnline !== "boolean") {
    return res.status(400).json({ error: "isOnline must be boolean" });
  }

  try {
    const outletId = req.auth!.outletId;
    const userId = req.auth!.userId;

    const status = await (prisma as any).outlet_status.upsert({
      where: { outlet_id: outletId },
      create: {
        outlet_id: outletId,
        is_online: isOnline,
        updated_by: userId,
      },
      update: {
        is_online: isOnline,
        updated_at: new Date(),
        updated_by: userId,
      },
    });

    import("../websockets").then(({ broadcast }) => {
      broadcast("outlet.store_status_updated", {
        outletId,
        isOnline: status.is_online,
      });
    }).catch(() => {});

    res.status(200).json({
      isOnline: status.is_online,
      updatedAt: status.updated_at.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
};

settingsRouter.post("/settings/outlet-status", requireAuth, handleUpdateOutletStatus);
settingsRouter.patch("/settings/outlet-status", requireAuth, handleUpdateOutletStatus);
settingsRouter.post("/settings/store-status", requireAuth, handleUpdateOutletStatus);
settingsRouter.patch("/settings/store-status", requireAuth, handleUpdateOutletStatus);

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
      const taxId = req.body.taxNumber === null || req.body.taxNumber === ""
        ? null
        : String(req.body.taxNumber).trim();
      await prisma.organization.update({
        where: { id: outlet.organizationId },
        data: { tax_id: taxId },
      });
    }

    const fresh = await prisma.outlet.findUnique({ where: { id: outletId } });
    const organization = await prisma.organization.findUnique({
      where: { id: outlet.organizationId },
    });
    res.status(200).json({
      id: fresh!.id,
      code: fresh!.code,
      name: fresh!.name,
      loyaltyPaisePerPoint: fresh!.loyaltyPaisePerPoint != null ? fresh!.loyaltyPaisePerPoint.toString() : null,
      taxNumber: organization?.tax_id || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});
