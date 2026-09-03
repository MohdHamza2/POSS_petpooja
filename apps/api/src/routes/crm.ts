import { Router } from "express";
import { requireAuth, requirePermission, AuthedRequest } from "../middleware/require-auth";
import { prisma } from "../prisma";

export const crmRouter = Router();

function mapCustomerResponse(c: any, accountBalance?: number) {
  return {
    id: c.id,
    outletId: c.outletId,
    name: c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    firstName: c.firstName || (c.name ? c.name.split(" ")[0] : ""),
    lastName: c.lastName || (c.name ? c.name.split(" ").slice(1).join(" ") : null),
    phone: c.phone,
    email: c.email || null,
    loyaltyPoints: accountBalance !== undefined
      ? accountBalance
      : (c.loyaltyPoints !== undefined ? Number(c.loyaltyPoints) : Number(c.loyalty_points || 0)),
    birthDate: c.birthDate ? new Date(c.birthDate).toISOString().split("T")[0] : (c.birth_date ? new Date(c.birth_date).toISOString().split("T")[0] : null),
    isActive: c.isActive ?? c.is_active ?? true,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
  };
}

async function loyaltyBalanceByCustomerIds(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const accts = await (prisma as any).loyalty_accounts.findMany({
    where: { customer_id: { in: ids } },
  });
  for (const a of accts) {
    map.set(a.customer_id, Number(a.balance));
  }
  return map;
}

// Create Customer
crmRouter.post("/customers", requireAuth, requirePermission("crm.write"), async (req: AuthedRequest, res) => {
  let firstName = req.body.firstName;
  let lastName = req.body.lastName;
  const phone = req.body.phone;
  const email = req.body.email;
  const birthDate = req.body.birthDate || req.body.dob;

  if (!firstName && req.body.name) {
    const parts = String(req.body.name).trim().split(" ");
    firstName = parts[0];
    lastName = parts.slice(1).join(" ") || undefined;
  }

  if (!firstName || !phone) {
    return res.status(400).json({ error: "Missing required fields: firstName/name, phone" });
  }

  try {
    const outletId = req.auth!.outletId;
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { organizationId: true },
    });
    const organization_id = outlet?.organizationId || "11111111-1111-1111-1111-111111111111";

    const customer = await prisma.customer.create({
      data: {
        organization_id,
        outletId,
        firstName: String(firstName).trim(),
        lastName: lastName ? String(lastName).trim() : undefined,
        name: `${firstName} ${lastName || ""}`.trim(),
        phone: String(phone).trim(),
        email: email ? String(email).trim() : undefined,
        birthDate: birthDate ? new Date(birthDate) : undefined,
        loyaltyPoints: Number(req.body.loyaltyPoints || 0),
        isActive: true,
      },
    });

    // Create loyalty account record if needed
    await (prisma as any).loyalty_accounts.create({
      data: {
        customer_id: customer.id,
        balance: Number(req.body.loyaltyPoints || 0),
        tier: "SILVER",
      },
    }).catch((err: any) => console.error('Background task error:', err?.message || err));

    res.status(201).json(mapCustomerResponse(customer));
  } catch (error: any) {
    console.error("Error creating customer:", error);
    res.status(500).json({ error: error.message });
  }
});

// List Customers (paginated, searchable directory)
crmRouter.get("/customers", requireAuth, requirePermission("crm.read"), async (req: AuthedRequest, res) => {
  try {
    const { search, limit, offset } = req.query;
    const outletId = req.auth!.outletId;

    const take = limit ? Math.min(Number(limit), 100) : 25;
    const skip = offset ? Number(offset) : 0;

    const where: any = {
      outletId,
      isActive: true,
    };

    if (typeof search === "string" && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: "desc" },
      }),
      prisma.customer.count({ where }),
    ]);

    const balances = await loyaltyBalanceByCustomerIds(customers.map((c) => c.id));
    res.status(200).json({
      customers: customers.map((c) => mapCustomerResponse(c, balances.get(c.id))),
      total,
      limit: take,
      offset: skip,
    });
  } catch (error: any) {
    console.error("Error listing customers:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Customer by ID
crmRouter.get("/customers/:id", requireAuth, requirePermission("crm.read"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const customer = await prisma.customer.findFirst({
      where: {
        id: req.params.id,
        outletId,
      },
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const balances = await loyaltyBalanceByCustomerIds([customer.id]);
    res.status(200).json(mapCustomerResponse(customer, balances.get(customer.id)));
  } catch (error: any) {
    console.error("Error fetching customer:", error);
    res.status(500).json({ error: error.message });
  }
});

// Anonymize Customer (DPDP)
crmRouter.post("/customers/:id/anonymize", requireAuth, requirePermission("crm.anonymize"), async (req: AuthedRequest, res) => {
  try {
    const outletId = req.auth!.outletId;
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        name: "Anonymized Customer",
        firstName: "Anonymized",
        lastName: null,
        phone: `ANON_${Date.now()}`,
        email: null,
        isActive: false,
      },
    });
    res.status(200).json(mapCustomerResponse(customer));
  } catch (error: any) {
    console.error("Error anonymizing customer:", error);
    res.status(500).json({ error: error.message });
  }
});

// Redeem Loyalty Points
crmRouter.post("/loyalty/redeem", requireAuth, requirePermission("crm.write"), async (req: AuthedRequest, res) => {
  const { customerId, points } = req.body;
  if (!customerId || points === undefined || Number(points) <= 0) {
    return res.status(400).json({ error: "Missing or invalid required fields: customerId, points (must be positive)" });
  }

  try {
    const outletId = req.auth!.outletId;
    const pts = Number(points);

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, outletId },
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    if (customer.loyaltyPoints < pts) {
      return res.status(400).json({ error: `Insufficient loyalty points: has ${customer.loyaltyPoints}, requested ${pts}` });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: {
        loyaltyPoints: { decrement: pts },
      },
    });

    await (prisma as any).loyalty_accounts.updateMany({
      where: { customer_id: customerId },
      data: {
        balance: { decrement: pts },
        updated_at: new Date(),
      },
    }).catch((err: any) => console.error('Background task error:', err?.message || err));

    res.status(200).json(mapCustomerResponse(updatedCustomer));
  } catch (error: any) {
    console.error("Error redeeming loyalty points:", error);
    res.status(400).json({ error: error.message });
  }
});

// POST /customers/:id/addresses - Add Delivery Address
crmRouter.post("/customers/:id/addresses", requireAuth, requirePermission("crm.write"), async (req: AuthedRequest, res) => {
  const { addressLine1, addressLine2, city, state, zipCode, isDefault } = req.body;
  if (!addressLine1 || !city || !zipCode) {
    return res.status(400).json({ error: "addressLine1, city, and zipCode are required" });
  }

  try {
    const outletId = req.auth!.outletId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, outletId },
    });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    if (isDefault) {
      await (prisma as any).customer_addresses.updateMany({
        where: { customer_id: customer.id },
        data: { is_default: false },
      });
    }

    const address = await (prisma as any).customer_addresses.create({
      data: {
        customer_id: customer.id,
        line1: addressLine1,
        line2: addressLine2 || null,
        city,
        postal_code: zipCode,
        is_default: isDefault || false,
      },
    });

    res.status(201).json({ success: true, address });
  } catch (error: any) {
    console.error("Error adding customer address:", error);
    res.status(500).json({ error: error.message });
  }
});
