require("dotenv").config();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const BIRYANI = "923df5bf-7d93-4061-926e-8a5c2c41d7d0";

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@restaurant.com",
      password: "admin123",
      outletId: OUTLET,
    }),
  });
  const TOK = (await lr.json()).accessToken;
  const H = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOK}`,
    "X-Outlet-Id": OUTLET,
  };
  const un86 = await fetch(`${BASE}/menu/items/${BIRYANI}/availability`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ isStocked: true }),
  });
  const un86Body = await un86.json().catch(() => null);
  const open = await fetch(`${BASE}/finance/cash-drawer/open`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ openingFloatMinor: "0" }),
  });
  const openBody = await open.json().catch(() => null);
  const drawer = await fetch(`${BASE}/finance/cash-drawer`, { headers: H }).then((r) => r.json());
  const avail = await fetch(`${BASE}/menu/availability`, { headers: H }).then((r) => r.json());
  const biryani = Array.isArray(avail)
    ? avail.find((i) => i.id === BIRYANI || i.menuItemId === BIRYANI || i.name === "Chicken Dum Biryani (Special)")
    : (avail.items || []).find((i) => i.name === "Chicken Dum Biryani (Special)");
  console.log(
    JSON.stringify(
      {
        un86: { status: un86.status, body: un86Body },
        open: { status: open.status, body: openBody },
        drawer: {
          sessionStatus: drawer.sessionStatus,
          expected: drawer.expectedCashMinor,
          cashSales: drawer.cashSalesMinor,
        },
        biryani: biryani && {
          id: biryani.id || biryani.menuItemId,
          name: biryani.name,
          isStocked: biryani.isStocked ?? biryani.availability?.isStocked,
          is86: biryani.is86,
        },
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
