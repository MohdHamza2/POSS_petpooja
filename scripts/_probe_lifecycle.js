// Temporary lifecycle probe. Drives order -> KOT -> kitchen -> serve -> bill -> settle -> vacant
// against the live API and prints state at each step. Read-only creds via login.
const BASE = "http://127.0.0.1:4001";
const EMAIL = "admin@restaurant.com";
const PASS = "admin123";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";

let TOK = "";
function H(extra) {
  return Object.assign(
    { "Content-Type": "application/json", Authorization: `Bearer ${TOK}`, "X-Outlet-Id": OUTLET },
    extra || {}
  );
}
async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H(),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  const txt = await res.text();
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: res.status, data };
}
function log(label, obj) {
  console.log(`\n### ${label}`);
  console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
}

(async () => {
  try {
    // 1. login (scoped token)
    const lr = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASS, outletId: OUTLET }),
    });
    const lj = await lr.json();
    TOK = lj.accessToken;
    console.log("login status", lr.status, "hasToken", !!TOK);
    if (!TOK) { console.log("LOGIN FAILED", JSON.stringify(lj)); return; }

    // 2. menu items
    const menu = await j("GET", "/menu/items");
    const items = Array.isArray(menu.data) ? menu.data : (menu.data.items || menu.data.data || []);
    const pick = items.find((i) => (i.priceMinor || i.price || i.basePrice || i.sellingPrice));
    log("MENU count / picked", { count: items.length, pick: pick && { id: pick.id, name: pick.name, price: pick.priceMinor || pick.price || pick.basePrice || pick.sellingPrice } });
    if (!pick) { log("MENU raw sample", items.slice(0, 2)); return; }

    // 3. tables -> pick a vacant one
    const tables = await j("GET", "/tables");
    const tarr = Array.isArray(tables.data) ? tables.data : (tables.data.tables || []);
    const vacant = tarr.find((t) => (t.status === "VACANT" || t.status === "AVAILABLE") && !t.currentOrder && !t.mergeGroupId);
    log("TABLES count / vacant pick", { count: tarr.length, vacant: vacant && { id: vacant.id, tableNumber: vacant.tableNumber, status: vacant.status } });
    if (!vacant) { log("TABLES sample", tarr.slice(0, 3)); return; }

    // 4. place KOT order
    const create = await j("POST", "/orders", {
      action: "KOT",
      diningTableId: vacant.id,
      tableNumber: vacant.tableNumber,
      orderType: "DINE_IN",
      items: [{ itemId: pick.id, quantity: 2 }],
    });
    log("CREATE ORDER (action=KOT)", { status: create.status, id: create.data && create.data.id, orderStatus: create.data && create.data.status, grand: create.data && create.data.grandTotalMinor });
    const orderId = create.data && create.data.id;
    if (!orderId) { log("CREATE raw", create.data); return; }

    // 5. order detail (kitchenStatus per line?)
    const detail = await j("GET", `/orders/${orderId}`);
    const dlines = (detail.data.items || detail.data.lines || []).map((l) => ({ name: l.name || l.menuItemName, qty: l.quantity, kitchenStatus: l.kitchenStatus, void: l.isVoid || l.voided }));
    log("ORDER DETAIL lines (kitchenStatus)", { status: detail.data.status, lines: dlines });

    // 6. find KOT ticket
    const kots = await j("GET", `/kitchen/kot?orderId=${orderId}`);
    const karr = Array.isArray(kots.data) ? kots.data : (kots.data.tickets || kots.data.kots || []);
    const mine = karr.filter((k) => k.orderId === orderId || (k.order && k.order.id === orderId));
    log("KOT tickets for order", mine.map((k) => ({ id: k.id, status: k.status, num: k.ticketNumber })));
    const kotId = (mine[0] || karr[0]) && (mine[0] || karr[0]).id;

    // 7. kitchen advance PREPARING -> READY
    if (kotId) {
      const p1 = await j("PATCH", `/kitchen/kot/${kotId}/status`, { toStatus: "PREPARING" });
      const p2 = await j("PATCH", `/kitchen/kot/${kotId}/status`, { toStatus: "READY" });
      log("KOT advance", { preparing: p1.status, ready: p2.status, readyData: p2.data && (p2.data.status || p2.data.error) });
    } else {
      log("KOT advance", "NO KOT TICKET FOUND");
    }

    // 8. table state after ready
    const t2 = await j("GET", "/tables");
    const t2arr = Array.isArray(t2.data) ? t2.data : (t2.data.tables || []);
    const tnow = t2arr.find((t) => t.id === vacant.id);
    log("TABLE after READY", tnow && { status: tnow.status, kitchenStage: tnow.kitchenStage, floorStatus: tnow.floorStatus, hasOrder: !!tnow.currentOrder });

    // 9. serve
    const serve = await j("POST", `/tables/${vacant.id}/serve`, {});
    log("SERVE", { status: serve.status, data: serve.data && (serve.data.status || serve.data.error || serve.data) });

    // 10. bill
    const bill = await j("GET", `/orders/${orderId}/bill`);
    log("BILL", { status: bill.status, grand: bill.data && (bill.data.grandTotalMinor || bill.data.grandTotal || bill.data.totalMinor), keys: bill.data && Object.keys(bill.data) });
    const due = bill.data && (bill.data.grandTotalMinor || bill.data.grandTotal || bill.data.totalMinor || 0);

    // 11. settle
    const settle = await j("POST", `/orders/${orderId}/settle`, { paymentMethod: "CASH", amountPaidMinor: Number(due) || undefined });
    log("SETTLE", { status: settle.status, data: settle.data && (settle.data.error || settle.data.invoiceNumber || settle.data.status || settle.data) });

    // 12. table vacant?
    const t3 = await j("GET", "/tables");
    const t3arr = Array.isArray(t3.data) ? t3.data : (t3.data.tables || []);
    const tfin = t3arr.find((t) => t.id === vacant.id);
    log("TABLE after SETTLE", tfin && { status: tfin.status, kitchenStage: tfin.kitchenStage, hasOrder: !!tfin.currentOrder });

    // 13. order final
    const of = await j("GET", `/orders/${orderId}`);
    log("ORDER final", { status: of.data.status, settledAt: of.data.settledAt, diningTableId: of.data.diningTableId });

    // 14. invoice via reporting
    const inv = await j("GET", `/reporting/invoices?limit=3`);
    log("REPORTING invoices (latest)", { status: inv.status, sample: Array.isArray(inv.data) ? inv.data.slice(0,2) : (inv.data.invoices ? inv.data.invoices.slice(0,2) : inv.data) });

    console.log("\n=== PROBE DONE ===");
  } catch (e) {
    console.log("PROBE ERROR", e && e.stack || String(e));
  }
})();
