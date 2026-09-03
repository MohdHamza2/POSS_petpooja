import { Router } from "express";
import { prisma } from "../prisma";
import { createPurchaseOrder, receiveGoods, transitionPurchaseOrder, PrismaPurchaseRepository } from "@kapmeta/purchase";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/require-auth";

const router = Router();

router.post("/purchase-orders", requireAuth, requirePermission("inventory.po.create"), async (req: AuthedRequest, res) => {
  try {
    const { vendorId, lines, isRetrospective, retrospectiveReasonCode, sequence } = req.body;
    const outletId = req.auth!.outletId;

    const input = {
      outletId,
      vendorId,
      lines: (lines ?? []).map((l: { ingredientId: string; quantity: number; unitCostMinor: string | number }) => ({
        ingredientId: l.ingredientId,
        quantity: l.quantity,
        unitCostMinor: BigInt(l.unitCostMinor),
      })),
      isRetrospective,
      retrospectiveReasonCode,
    };

    const result = await createPurchaseOrder(input, sequence ?? 1, new PrismaPurchaseRepository(prisma));

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("retrospectiveReasonCode is mandatory")) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/goods-received-notes", requireAuth, requirePermission("inventory.grn.create"), async (req: AuthedRequest, res) => {
  try {
    const { vendorId, purchaseOrderId, invoiceNumber, lines, sequence } = req.body;
    const outletId = req.auth!.outletId;

    const input = {
      outletId,
      vendorId,
      purchaseOrderId,
      invoiceNumber,
      lines: (lines ?? []).map((l: {
        ingredientId: string;
        orderedQuantity: number;
        receivedQuantity: number;
        unitCostMinor: string | number;
      }) => ({
        ingredientId: l.ingredientId,
        orderedQuantity: l.orderedQuantity,
        receivedQuantity: l.receivedQuantity,
        unitCostMinor: BigInt(l.unitCostMinor),
      })),
    };

    const result = await receiveGoods(input, sequence ?? 1, new PrismaPurchaseRepository(prisma));

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
});

router.patch(
  "/purchase-orders/:id/status",
  requireAuth,
  requirePermission("inventory.po.approve"),
  async (req: AuthedRequest, res) => {
    try {
      const { toStatus } = req.body;

      const result = await transitionPurchaseOrder(
        req.params.id,
        toStatus,
        new PrismaPurchaseRepository(prisma),
        req.auth!.userId,
      );

      if (!result.ok) {
        res.status(409).json({ error: "illegal transition", from: result.from, to: result.to });
        return;
      }

      res.status(200).json({ status: result.newStatus });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  },
);

router.post(
  "/purchase-orders/:id/pay",
  requireAuth,
  requirePermission("inventory.po.approve"),
  async (req: AuthedRequest, res) => {
    try {
      const { paymentMethod } = req.body;
      const outletId = req.auth!.outletId;
      const poId = req.params.id;

      const po = await prisma.purchase_orders.findUnique({ where: { id: poId } });
      if (!po) return res.status(404).json({ error: "PO not found" });
      if (po.status === "PAID") return res.status(400).json({ error: "PO already paid" });
      
      const newStatus = "PAID";
      await prisma.purchase_orders.update({
        where: { id: poId },
        data: { status: newStatus }
      });

      // Write to petty cash
      if (paymentMethod === "CASH") {
        await prisma.petty_cash_ledger.create({
          data: {
            outlet_id: outletId,
            amount_minor: -po.total_amount_minor, // negative for expense
            category: "PO_PAYMENT",
            description: `Paid PO ${po.po_number}`,
            recorded_by: req.auth!.userId,
          }
        });
      }
      
      res.status(200).json({ status: newStatus });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "internal error" });
    }
  }
);

export const purchaseRouter = router;
