require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

(async () => {
  const lr = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@restaurant.com", password: "admin123", outletId: OUTLET }),
  });
  const { accessToken } = await lr.json();
  const H = { Authorization: `Bearer ${accessToken}`, "X-Outlet-Id": OUTLET, "Content-Type": "application/json" };

  const [avail, channels, export86, store] = await Promise.all([
    fetch(`${BASE}/menu/availability`, { headers: H }).then((r) => r.json()),
    fetch(`${BASE}/integration/channel-items`, { headers: H }).then((r) => r.json()),
    fetch(`${BASE}/inventory/availability/export`, { headers: H }).then((r) => r.json()),
    fetch(`${BASE}/settings/store-status`, { headers: H }).then((r) => r.json()),
  ]);

  const offAvail = (avail || []).filter((i) => i.isStocked === false).map((i) => ({ id: i.id || i.menuItemId, name: i.name }));
  const offExport = (export86 || []).filter((i) => i.isStocked === false).map((i) => i.name);
  const channelNames = (channels || []).map((i) => ({ name: i.name, overall: i.overallStatus, nChan: (i.channels || []).length }));
  const missingOnChannels = offAvail.filter((a) => !(channels || []).some((c) => c.menuItemId === a.id || c.name === a.name));

  const rows = await prisma.item_availability.findMany({
    where: { outlet_id: OUTLET, state: "OFF" },
    select: { item_id: true, channel_id: true, state: true, version: true },
  });
  const accounts = await prisma.channelAccount.findMany({
    where: { outletId: OUTLET },
    select: { id: true, is_active: true, credentialsRef: true },
  });

  console.log(
    json({
      store,
      menuAvailCount: Array.isArray(avail) ? avail.length : avail,
      menuOff: offAvail,
      exportOff: offExport,
      channelCount: Array.isArray(channels) ? channels.length : channels,
      channelSample: channelNames.slice(0, 8),
      missing86OnChannelPage: missingOnChannels,
      availabilityOffRows: rows.length,
      channelAccounts: accounts,
    })
  );
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
