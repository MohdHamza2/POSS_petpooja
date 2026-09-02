require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
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
  const prisma = new PrismaClient();
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "db", "migrations", "0025_unique_kot_item_order_item.sql"),
      "utf8"
    );
    const statements = sql
      .replace(/BEGIN;|COMMIT;/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }
    log("unique kot index", "applied 0025");

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
    if (!TOK) throw new Error("login failed");

    const avail = await j("GET", "/menu/availability");
    const availItems = Array.isArray(avail.data) ? avail.data : [];
    const biryani = availItems.find((i) => i.name && i.name.includes("Biryani")) || availItems[0];
    log("menu item", { id: biryani && biryani.id, name: biryani && biryani.name, hasModifiers: biryani && biryani.hasModifiers });

    const mods = await j("GET", `/menu/items/${biryani.id}/modifiers`);
    log("catalog modifiers", { status: mods.status, groups: Array.isArray(mods.data) ? mods.data.length : mods.data });

    const tbls = await j("GET", "/tables");
    const tarr = Array.isArray(tbls.data) ? tbls.data : [];
    const vac = tarr.find(
      (t) =>
        (t.status === "VACANT" || t.status === "AVAILABLE") &&
        !t.currentOrder &&
        !t.mergeGroupId
    );
    if (!vac) throw new Error("no vacant table");
    log("vacant table", { id: vac.id, number: vac.tableNumber, status: vac.status });

    const hold = await j("POST", "/orders", {
      action: "HOLD",
      diningTableId: vac.id,
      tableNumber: vac.tableNumber,
      orderType: "DINE_IN",
      lines: [{ menuItemId: biryani.id, quantity: 1 }],
    });
    const hid = hold.data && hold.data.id;
    log("HOLD create", { status: hold.status, id: hid, orderStatus: hold.data && hold.data.status, advance: hold.data && hold.data.advanceStatus, error: hold.data && hold.data.error });
    if (!hid || hold.status >= 400) throw new Error("HOLD create failed");

    const afterHoldTables = await j("GET", "/tables");
    const heldTable = (Array.isArray(afterHoldTables.data) ? afterHoldTables.data : []).find((t) => t.id === vac.id);
    log("table after HOLD", { status: heldTable && heldTable.status, activeOrderId: heldTable && heldTable.activeOrderId, kitchenStage: heldTable && heldTable.kitchenStage });

    const heldList = await j("GET", "/orders/held");
    const inHeld = Array.isArray(heldList.data) && heldList.data.some((o) => o.id === hid);
    log("GET /orders/held", { status: heldList.status, count: Array.isArray(heldList.data) ? heldList.data.length : 0, includesHold: inHeld });

    const fire = await j("POST", `/orders/${hid}/fire-advance`, {});
    log("fire-advance", { status: fire.status, data: fire.data });

    const afterFireTables = await j("GET", "/tables");
    const firedTable = (Array.isArray(afterFireTables.data) ? afterFireTables.data : []).find((t) => t.id === vac.id);
    log("table after fire", {
      status: firedTable && firedTable.status,
      kitchenStage: firedTable && firedTable.kitchenStage,
      kotCount: firedTable && firedTable.currentOrder && firedTable.currentOrder.kots && firedTable.currentOrder.kots.length,
    });

    const kotTickets = await prisma.kOTTicket.findMany({
      where: { orderId: hid },
      include: { kotItems: true },
      orderBy: { createdAt: "asc" },
    });
    log("kots after fire", kotTickets.map((k) => ({ id: k.id, status: k.status, items: k.kotItems.length, orderItemIds: k.kotItems.map((i) => i.orderItemId) })));

    const firstKot = kotTickets[0];
    if (firstKot) {
      const prep = await j("PATCH", `/kitchen/kot/${firstKot.id}/status`, { toStatus: "PREPARING" });
      log("KOT PREPARING", { status: prep.status, data: prep.data });
      const ready = await j("PATCH", `/kitchen/kot/${firstKot.id}/status`, { toStatus: "READY" });
      log("KOT READY", { status: ready.status, data: ready.data });
    }

    const afterReadyTables = await j("GET", "/tables");
    const readyTable = (Array.isArray(afterReadyTables.data) ? afterReadyTables.data : []).find((t) => t.id === vac.id);
    log("table after READY", { kitchenStage: readyTable && readyTable.kitchenStage, statuses: readyTable && readyTable.currentOrder && (readyTable.currentOrder.kots || []).map((k) => k.status) });

    const extra = availItems.find((i) => i.id !== biryani.id && i.isStocked) || biryani;
    const add = await j("POST", `/orders/${hid}/items`, {
      lines: [{ menuItemId: extra.id, quantity: 1 }],
    });
    log("add-items", { status: add.status, added: add.data });

    const kots2 = await prisma.kOTTicket.findMany({
      where: { orderId: hid },
      include: { kotItems: true },
      orderBy: { createdAt: "asc" },
    });
    const allItemIds = kots2.flatMap((k) => k.kotItems.map((i) => i.orderItemId).filter(Boolean));
    const uniqueIds = new Set(allItemIds);
    log("kots after add-items", {
      ticketCount: kots2.length,
      statuses: kots2.map((k) => k.status),
      kotItemCount: allItemIds.length,
      uniqueOrderItemIds: uniqueIds.size,
      duplicate: allItemIds.length !== uniqueIds.size,
    });

    const afterAddTables = await j("GET", "/tables");
    const addTable = (Array.isArray(afterAddTables.data) ? afterAddTables.data : []).find((t) => t.id === vac.id);
    log("table after add-items (expect QUEUED)", {
      kitchenStage: addTable && addTable.kitchenStage,
      statuses: addTable && addTable.currentOrder && (addTable.currentOrder.kots || []).map((k) => k.status),
    });

    for (const k of kots2) {
      if (k.status !== "SERVED" && k.status !== "CANCELLED") {
        await j("PATCH", `/kitchen/kot/${k.id}/status`, { toStatus: "PREPARING" }).catch(() => {});
        await j("PATCH", `/kitchen/kot/${k.id}/status`, { toStatus: "READY" }).catch(() => {});
        await j("PATCH", `/kitchen/kot/${k.id}/status`, { toStatus: "SERVED" }).catch(() => {});
      }
    }

    const bill = await j("GET", `/orders/${hid}/bill`);
    const settle = await j("POST", `/orders/${hid}/settle`, {
      paymentMethod: "CASH",
      amountPaidMinor: Number(bill.data && bill.data.grandTotalMinor),
    });
    log("SETTLE", { status: settle.status, invoice: settle.data && settle.data.invoiceNumber, error: settle.data && settle.data.error });

    const again = await j("POST", `/orders/${hid}/settle`, {
      paymentMethod: "CASH",
      amountPaidMinor: Number(bill.data && bill.data.grandTotalMinor),
    });
    log("re-settle", { status: again.status, code: again.data && again.data.code });

    const vacantAfter = await j("GET", "/tables");
    const doneTable = (Array.isArray(vacantAfter.data) ? vacantAfter.data : []).find((t) => t.id === vac.id);
    log("table after settle", { status: doneTable && doneTable.status, activeOrderId: doneTable && doneTable.activeOrderId });
  } catch (err) {
    console.error("PROBE FAILED", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
