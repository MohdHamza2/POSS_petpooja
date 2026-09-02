// Hotel P0 probe: waiter /payments complete vs settle vs occupancy vs KOT vs drawer.
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
function snapTable(tarr, id) {
  const t = tarr.find((x) => x.id === id);
  return t && {
    id: t.id,
    tableNumber: t.tableNumber,
    status: t.status,
    currentOrderId: t.currentOrderId || t.currentOrder?.id || null,
    kitchenStage: t.kitchenStage || null,
  };
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
    const lj = await lr.json();
    TOK = lj.accessToken;
    if (!TOK) {
      console.log("LOGIN FAIL", lj);
      return;
    }

    const menu = await j("GET", "/menu/items");
    const items = (Array.isArray(menu.data) ? menu.data : menu.data.items || []).filter(
      (i) => i.priceMinor || i.price
    );
    const A = items[0];
    const B = items[1] || items[0];
    const tbls = await j("GET", "/tables");
    const tarr = Array.isArray(tbls.data) ? tbls.data : tbls.data.tables || [];
    const vac = tarr.filter(
      (t) =>
        (t.status === "VACANT" || t.status === "AVAILABLE") &&
        !t.currentOrder &&
        !t.mergeGroupId
    );
    const T1 = vac[0];
    const T2 = vac[1];
    log("picked", {
      A: A && { id: A.id, name: A.name, price: A.priceMinor },
      T1: T1 && T1.tableNumber,
      T2: T2 && T2.tableNumber,
    });
    if (!A || !T1 || !T2) return;

    const drawer0 = await j("GET", "/finance/cash-drawer");
    log("drawer BEFORE", {
      status: drawer0.status,
      expected: drawer0.data && drawer0.data.expectedCashMinor,
      sessionStatus: drawer0.data && drawer0.data.sessionStatus,
    });
    const occ0 = await j("GET", "/tables/occupancy");
    log("occupancy BEFORE", {
      occupied: occ0.data && occ0.data.occupiedTables,
      rate: occ0.data && occ0.data.occupancyRatePercent,
    });

    // ===== SCENARIO 1: waiter full-cash /payments then /settle =====
    const c1 = await j("POST", "/orders", {
      action: "KOT",
      diningTableId: T1.id,
      tableNumber: T1.tableNumber,
      orderType: "DINE_IN",
      lines: [{ menuItemId: A.id, quantity: 1 }],
    });
    const oid1 = c1.data && c1.data.id;
    log("S1 create KOT", {
      status: c1.status,
      oid: oid1,
      ost: c1.data && c1.data.status,
      grand: c1.data && (c1.data.grandTotalMinor || c1.data.grandTotal),
    });
    const k1 = await j("GET", `/kitchen/kot?orderId=${oid1}`);
    const k1a = Array.isArray(k1.data) ? k1.data : k1.data.tickets || k1.data.kots || [];
    log(
      "S1 KOT after create",
      k1a
        .filter((k) => k.orderId === oid1)
        .map((k) => ({ id: k.id, status: k.status, num: k.ticketNumber }))
    );

    const bill1 = await j("GET", `/orders/${oid1}/bill`);
    const due1 = Number(bill1.data.dueMinor || bill1.data.grandTotalMinor || 0);
    log("S1 bill due", { status: bill1.status, due: due1, paid: bill1.data.paidMinor });

    const pay1 = await j("POST", `/orders/${oid1}/payments`, {
      amountMinor: due1,
      method: "CASH",
    });
    log("S1 POST /payments", {
      status: pay1.status,
      orderStatus: pay1.data && pay1.data.orderStatus,
      success: pay1.data && pay1.data.success,
      error: pay1.data && pay1.data.error,
    });

    const oAfterPay = await j("GET", `/orders/${oid1}`);
    log("S1 order AFTER payments", {
      status: oAfterPay.data && oAfterPay.data.status,
      settledAt: oAfterPay.data && oAfterPay.data.settledAt,
    });
    const invAfterPay = await j("GET", `/reporting/invoices?orderId=${oid1}`);
    log("S1 invoices AFTER payments", {
      status: invAfterPay.status,
      sample: Array.isArray(invAfterPay.data)
        ? invAfterPay.data.slice(0, 1)
        : invAfterPay.data,
    });
    const tblsPay = await j("GET", "/tables");
    const tarrPay = Array.isArray(tblsPay.data) ? tblsPay.data : tblsPay.data.tables || [];
    log("S1 table AFTER payments", snapTable(tarrPay, T1.id));
    const occPay = await j("GET", "/tables/occupancy");
    log("S1 occupancy AFTER payments", {
      occupied: occPay.data && occPay.data.occupiedTables,
      rate: occPay.data && occPay.data.occupancyRatePercent,
    });
    const kPay = await j("GET", `/kitchen/kot?orderId=${oid1}`);
    const kPaya = Array.isArray(kPay.data) ? kPay.data : kPay.data.tickets || [];
    log(
      "S1 KOT AFTER payments (still cooking?)",
      kPaya
        .filter((k) => k.orderId === oid1)
        .map((k) => ({ id: k.id, status: k.status }))
    );
    const drawerPay = await j("GET", "/finance/cash-drawer");
    log("S1 drawer AFTER payments (before settle)", {
      expected: drawerPay.data && drawerPay.data.expectedCashMinor,
      sessionStatus: drawerPay.data && drawerPay.data.sessionStatus,
    });

    const s1 = await j("POST", `/orders/${oid1}/settle`, { paymentMethod: "CASH" });
    log("S1 first settle", {
      status: s1.status,
      alreadySettled: s1.data && s1.data.alreadySettled,
      invoice: s1.data && s1.data.invoiceNumber,
      error: s1.data && s1.data.error,
    });
    const s1b = await j("POST", `/orders/${oid1}/settle`, { paymentMethod: "CASH" });
    log("S1 SECOND settle (expect 409)", {
      status: s1b.status,
      alreadySettled: s1b.data && s1b.data.alreadySettled,
      error: s1b.data && s1b.data.error,
    });
    const drawerS = await j("GET", "/finance/cash-drawer");
    log("S1 drawer AFTER settle", {
      expected: drawerS.data && drawerS.data.expectedCashMinor,
    });
    const oSettled = await j("GET", `/orders/${oid1}`);
    log("S1 order AFTER settle", {
      status: oSettled.data && oSettled.data.status,
      settledAt: oSettled.data && oSettled.data.settledAt,
    });
    const tblsS = await j("GET", "/tables");
    const tarrS = Array.isArray(tblsS.data) ? tblsS.data : tblsS.data.tables || [];
    log("S1 table AFTER settle", snapTable(tarrS, T1.id));

    // ===== SCENARIO 2: POS settle while KOT still QUEUED =====
    const c2 = await j("POST", "/orders", {
      action: "KOT",
      diningTableId: T2.id,
      tableNumber: T2.tableNumber,
      orderType: "DINE_IN",
      lines: [{ menuItemId: A.id, quantity: 1 }, { menuItemId: B.id, quantity: 1 }],
    });
    const oid2 = c2.data && c2.data.id;
    log("S2 create cooking order", { status: c2.status, oid: oid2, ost: c2.data && c2.data.status });
    const add2 = await j("POST", `/orders/${oid2}/items`, {
      lines: [{ menuItemId: B.id, quantity: 1 }],
    });
    log("S2 add-items", { status: add2.status, error: add2.data && add2.data.error });
    const k2 = await j("GET", `/kitchen/kot?orderId=${oid2}`);
    const k2a = Array.isArray(k2.data) ? k2.data : k2.data.tickets || [];
    log(
      "S2 KOT tickets after add",
      k2a.filter((k) => k.orderId === oid2).map((k) => ({ id: k.id, status: k.status }))
    );
    const bill2 = await j("GET", `/orders/${oid2}/bill`);
    const due2 = Number(bill2.data.dueMinor || bill2.data.grandTotalMinor || 0);
    const s2 = await j("POST", `/orders/${oid2}/settle`, {
      paymentMethod: "CASH",
      amountPaidMinor: due2,
    });
    log("S2 settle while QUEUED", {
      status: s2.status,
      alreadySettled: s2.data && s2.data.alreadySettled,
      invoice: s2.data && s2.data.invoiceNumber,
      error: s2.data && s2.data.error,
    });
    const k2b = await j("GET", `/kitchen/kot?orderId=${oid2}`);
    const k2ba = Array.isArray(k2b.data) ? k2b.data : k2b.data.tickets || [];
    log(
      "S2 KOT AFTER settle (still on KDS?)",
      k2ba.filter((k) => k.orderId === oid2).map((k) => ({ id: k.id, status: k.status }))
    );
    const tbls2 = await j("GET", "/tables");
    const tarr2 = Array.isArray(tbls2.data) ? tbls2.data : tbls2.data.tables || [];
    log("S2 table AFTER settle-while-cooking", snapTable(tarr2, T2.id));
    const occ2 = await j("GET", "/tables/occupancy");
    log("S2 occupancy AFTER settle-while-cooking", {
      occupied: occ2.data && occ2.data.occupiedTables,
      rate: occ2.data && occ2.data.occupancyRatePercent,
    });

    console.log("\n=== P0 SETTLER PROBE DONE ===");
  } catch (e) {
    console.log("ERR", e && e.stack ? e.stack : String(e));
  }
})();
