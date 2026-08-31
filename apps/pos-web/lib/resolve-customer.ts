import { authedFetch } from "./auth";

/** Find an existing CRM customer by exact phone, or create one.
 *  Name-only walk-ins get a non-dialable WALKIN-* phone so the cover still
 *  writes a customer row (loyalty still needs a real phone to look them up). */
export async function resolveCustomerId(opts: {
  phone?: string;
  name?: string;
}): Promise<string | undefined> {
  const phone = String(opts.phone || "").replace(/\s+/g, "").trim();
  const name = String(opts.name || "").trim();
  const walkin =
    phone.length < 8 &&
    name.length >= 2 &&
    `WALKIN-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())}`;
  const resolvedPhone = phone.length >= 8 ? phone : walkin;
  if (!resolvedPhone) return undefined;
  // #region agent log
  fetch('http://127.0.0.1:7323/ingest/28c85a32-5ef1-4fe5-9437-78139f7a5bfb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9c675b'},body:JSON.stringify({sessionId:'9c675b',hypothesisId:'C1',location:'resolve-customer.ts',message:'resolve customer',data:{hasRealPhone:phone.length>=8,hasName:name.length>=2,walkin:Boolean(walkin)},timestamp:Date.now(),runId:'cover-0029'})}).catch(()=>{});
  // #endregion

  if (phone.length >= 8) {
    const search = await authedFetch(`/crm/customers?search=${encodeURIComponent(phone)}&limit=25`);
    if (search.ok) {
      const data = await search.json();
      const list = Array.isArray(data?.customers) ? data.customers : [];
      const exact = list.find(
        (c: { phone?: string }) => String(c.phone || "").replace(/\s+/g, "") === phone
      );
      if (exact?.id) return exact.id as string;
    }
  }

  const parts = (name || "Guest").split(/\s+/).filter(Boolean);
  const create = await authedFetch("/crm/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: parts[0] || "Guest",
      lastName: parts.slice(1).join(" ") || undefined,
      phone: resolvedPhone,
    }),
  });
  if (!create.ok) return undefined;
  const created = await create.json();
  return created?.id as string | undefined;
}

export function guestPhoneForForm(phone?: string | null): string {
  const p = String(phone || "").trim();
  if (!p || /^WALKIN-/i.test(p)) return "";
  return p;
}

export function guestNameFromCustomer(c: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const parts = [c.firstName, c.lastName].filter((x) => String(x || "").trim()).join(" ").trim();
  return parts || String(c.name || "").trim();
}

export async function existingOrResolvedCustomerId(opts: {
  existingId?: string | null;
  phone?: string;
  name?: string;
}): Promise<string | undefined> {
  if (opts.existingId) return opts.existingId;
  return resolveCustomerId({ phone: opts.phone, name: opts.name });
}

export async function fetchCustomerGuestFields(
  customerId?: string | null
): Promise<{ name: string; phone: string } | null> {
  if (!customerId) return null;
  const res = await authedFetch(`/crm/customers/${customerId}`);
  if (!res.ok) return null;
  const c = await res.json();
  return {
    name: guestNameFromCustomer(c),
    phone: guestPhoneForForm(c.phone),
  };
}
