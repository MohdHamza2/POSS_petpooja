// DoD probe: BOM/stock, GST inclusive vs POS additive 5%, CRM loyalty without customerId.
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
let TOK = "";
function H() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
  };
}
async function j(m, p, b) {
  const r = await fetch(`${BASE}${p}`, {
    method: m,
    headers: H(),
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return { status: r.status, data: d };
}
function log(l, o) {
  console.log(`\n### ${l}`);
  console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2));
}

(async () => {
  try {
    const lr = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@restaurant.com",
        password: "admin123",
        outletId: OUTLET,
      }),
    });
    TOK = (await lr.json()).accessToken;
    if (!TOK) return;

    const recipes = await j("GET", "/inventory/recipes");
    const recs = Array.isArray(recipes.data)
      ? recipes.data
      : recipes.data.recipes || [];
    log("RECIPES", {
      status: recipes.status,
      count: recs.length,
      sample: recs.slice(0, 2).map((r) => ({
        id: r.id,
        menuItemId: r.menuItemId || r.menu_item_id,
        name: r.name,
        ings: (r.recipeIngredients || r.recipe_ingredients || []).length,
      })),
    });
    const recWithBom = recs.find(
      (r) => (r.recipeIngredients || r.recipe_ingredients || []).length > 0
    );
    const menu = await j("GET", "/menu/items");
    const items = Array.isArray(menu.data) ? menu.data : menu.data.items || [];
    let pick = recWithBom
      ? items.find(
          (i) => i.id === (recWithBom.menuItemId || recWithBom.menu_item_id)
        )
      : null;
    if (!pick) pick = items.find((i) => i.priceMinor || i.price);
    log("PICK item", {
      id: pick && pick.id,
      name: pick && pick.name,
      priceMinor: pick && (pick.priceMinor || pick.price),
      taxRate: pick && pick.taxRate,
      hasRecipe: Boolean(recWithBom),
    });

    const ingsBefore = recWithBom
      ? (recWithBom.recipeIngredients || recWithBom.recipe_ingredients || []).map(
          (ri) => ({
            id: ri.ingredientId || ri.ingredient_id || ri.ingredient?.id,
            name: ri.ingredient?.name || ri.name,
            qty: ri.quantity,
            stock: ri.ingredient?.currentStock || ri.currentStock,
          })
        )
      : [];
    log("BOM ingredients BEFORE", ingsBefore);

    const invBefore = await j("GET", "/inventory/ingredients");
    const ingList = Array.isArray(invBefore.data)
      ? invBefore.data
      : invBefore.data.ingredients || [];
    const bomIds = new Set(ingsBefore.map((x) => x.id).filter(Boolean));
    const stockBefore = ingList
      .filter((i) => bomIds.has(i.id))
      .map((i) => ({ id: i.id, name: i.name, stock: i.currentStock }));
    log("ingredient stock BEFORE", stockBefore);

    const tbls = await j("GET", "/tables");
    const tarr = Array.isArray(tbls.data) ? tbls.data : tbls.data.tables || [];
    const vac = tarr.find(
      (t) =>
        (t.status === "VACANT" || t.status === "AVAILABLE") &&
        !t.currentOrder &&
        !t.mergeGroupId
    );
    log("vacant table", vac && { id: vac.id, n: vac.tableNumber });
    if (!pick || !vac) return;

    const create = await j("POST", "/orders", {
      action: "KOT",
      diningTableId: vac.id,
      tableNumber: vac.tableNumber,
      orderType: "DINE_IN",
      lines: [{ menuItemId: pick.id, quantity: 1 }],
    });
    const oid = create.data && create.data.id;
    const bill = await j("GET", `/orders/${oid}/bill`);
    const detail = await j("GET", `/orders/${oid}`);
    const price = Number(pick.priceMinor || 0);
    const posAdditive = Math.round(price * 0.05);
    log("GST compare", {
      menuPrice: price,
      menuTaxRate: pick.taxRate,
      orderStatus: detail.data && detail.data.status,
      billSubtotal: bill.data && bill.data.subtotalMinor,
      billTax: bill.data && bill.data.taxTotalMinor,
      billGrand: bill.data && bill.data.grandTotalMinor,
      posWouldAddTax: posAdditive,
      posWouldGrand: price + posAdditive,
    });

    const crmBefore = await j("GET", "/crm/customers?limit=5");
    log("CRM before", {
      status: crmBefore.status,
      total: crmBefore.data && crmBefore.data.total,
      first: (crmBefore.data && crmBefore.data.customers && crmBefore.data.customers[0]) || null,
    });

    const settle = await j("POST", `/orders/${oid}/settle`, {
      paymentMethod: "CASH",
      amountPaidMinor: Number(bill.data.grandTotalMinor || price),
    });
    log("SETTLE", {
      status: settle.status,
      invoice: settle.data && settle.data.invoiceNumber,
      already: settle.data && settle.data.alreadySettled,
      error: settle.data && settle.data.error,
    });

    const recipesAfter = await j("GET", "/inventory/recipes");
    const recsA = Array.isArray(recipesAfter.data)
      ? recipesAfter.data
      : recipesAfter.data.recipes || [];
    const recA = recsA.find((r) => r.id === (recWithBom && recWithBom.id)) || recWithBom;
    const ingsAfter = recA
      ? (recA.recipeIngredients || recA.recipe_ingredients || []).map((ri) => ({
          id: ri.ingredientId || ri.ingredient_id || ri.ingredient?.id,
          name: ri.ingredient?.name || ri.name,
          stock: ri.ingredient?.currentStock || ri.currentStock,
        }))
      : [];
    log("BOM ingredients AFTER settle", ingsAfter);

    const invAfter = await j("GET", "/inventory/ingredients");
    const ingListA = Array.isArray(invAfter.data)
      ? invAfter.data
      : invAfter.data.ingredients || [];
    const stockAfter = ingListA
      .filter((i) => bomIds.has(i.id))
      .map((i) => ({ id: i.id, name: i.name, stock: i.currentStock }));
    log("ingredient stock AFTER", stockAfter);

    const crmAfter = await j("GET", "/crm/customers?limit=5");
    log("CRM after settle (no customerId sent)", {
      total: crmAfter.data && crmAfter.data.total,
      firstPoints:
        crmAfter.data &&
        crmAfter.data.customers &&
        crmAfter.data.customers[0] &&
        crmAfter.data.customers[0].loyaltyPoints,
    });

    const outlet = await j("GET", "/settings/store-status");
    log("store-status", { status: outlet.status, keys: outlet.data && Object.keys(outlet.data) });

    const me = await j("GET", "/auth/me");
    log("auth/me outlet", me.data && me.data.outlet);

    const avail = await j("GET", "/menu/availability");
    const availItems = Array.isArray(avail.data) ? avail.data : [];
    const availPick = availItems.find((i) => i.id === pick.id) || availItems[0];
    log("availability taxRate field", {
      id: availPick && availPick.id,
      name: availPick && availPick.name,
      taxRate: availPick && availPick.taxRate,
      keys: availPick && Object.keys(availPick),
    });

    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const logs = await prisma.inventoryConsumptionLog.findMany({
        where: { orderId: oid },
      });
      log("consumption ledger for anonymous settle", logs.map((l) => ({
        ingredientId: l.ingredientId,
        qty: Number(l.quantityDeducted),
        remaining: Number(l.remainingStock),
        shortage: Number(l.shortage),
        reason: l.reasonCode,
      })));
      const outletRow = await prisma.outlet.findUnique({
        where: { id: OUTLET },
        select: { loyaltyPaisePerPoint: true, name: true },
      });
      const org = await prisma.organization.findFirst();
      log("outlet loyalty + org tax", {
        loyaltyPaisePerPoint: outletRow && String(outletRow.loyaltyPaisePerPoint),
        orgTaxId: org && org.tax_id,
        orgName: org && org.name,
      });

      const phone = `98${String(Date.now()).slice(-8)}`;
      const createdCust = await j("POST", "/crm/customers", {
        firstName: "Cover",
        lastName: "Guest",
        phone,
      });
      log("CRM create", {
        status: createdCust.status,
        id: createdCust.data && createdCust.data.id,
        points: createdCust.data && createdCust.data.loyaltyPoints,
        error: createdCust.data && createdCust.data.error,
      });
      const cid = createdCust.data && createdCust.data.id;
      const tbls2 = await j("GET", "/tables");
      const tarr2 = Array.isArray(tbls2.data) ? tbls2.data : tbls2.data.tables || [];
      const vac2 = tarr2.find(
        (t) =>
          (t.status === "VACANT" || t.status === "AVAILABLE") &&
          !t.currentOrder &&
          !t.mergeGroupId
      );
      if (cid && vac2 && pick) {
        const create2 = await j("POST", "/orders", {
          action: "KOT",
          diningTableId: vac2.id,
          tableNumber: vac2.tableNumber,
          orderType: "DINE_IN",
          customerId: cid,
          lines: [{ menuItemId: pick.id, quantity: 1 }],
        });
        const oid2 = create2.data && create2.data.id;
        const bill2 = await j("GET", `/orders/${oid2}/bill`);
        const settle2 = await j("POST", `/orders/${oid2}/settle`, {
          paymentMethod: "CASH",
          amountPaidMinor: Number((bill2.data && bill2.data.grandTotalMinor) || 0),
          customerId: cid,
        });
        log("SETTLE with customerId", {
          status: settle2.status,
          invoice: settle2.data && settle2.data.invoiceNumber,
          error: settle2.data && settle2.data.error,
          oid2,
        });
        const custAfter = await j("GET", `/crm/customers/${cid}`);
        const acct = await prisma.loyalty_accounts.findUnique({
          where: { customer_id: cid },
        }).catch(() => null);
        log("CRM after customer settle", {
          apiPoints: custAfter.data && custAfter.data.loyaltyPoints,
          acctBalance: acct && acct.balance,
          acctTier: acct && acct.tier,
        });
        const logs2 = await prisma.inventoryConsumptionLog.findMany({
          where: { orderId: oid2 },
        });
        log("consumption ledger customer settle", {
          count: logs2.length,
          reasons: logs2.map((l) => l.reasonCode),
        });
        const settle2b = await j("POST", `/orders/${oid2}/settle`, {
          paymentMethod: "CASH",
        });
        log("re-settle", { status: settle2b.status, error: settle2b.data && settle2b.data.error });
      }
    } finally {
      await prisma.$disconnect();
    }

    console.log("\n=== DOD STOCK/GST/CRM PROBE DONE ===");
  } catch (e) {
    console.log("ERR", e && e.stack ? e.stack : String(e));
  }
})();
