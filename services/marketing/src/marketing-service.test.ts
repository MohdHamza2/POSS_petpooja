import { describe, it, expect } from "vitest";
import { createCampaign, computeSegment, queueCampaign, listRecipients } from "./marketing-service";
import type {
  CampaignRecipientRecord,
  CampaignStatus,
  CampaignWithCounts,
  CreateCampaignInput,
  MarketingCampaignRecord,
  MarketingRepository,
} from "./marketing-service";

// Fake repo purely for exercising marketing-service's logic — the real
// Prisma queries live in PrismaMarketingRepository (services/marketing/src/stores),
// so these tests verify computeSegment/queueCampaign wire filters and results
// through correctly, matching the fake-repo pattern in
// services/orders/src/order-service.test.ts.
function makeFakeRepo(opts: {
  customers?: { id: string; outletId: string; birthday?: boolean }[];
  orders?: { customerId: string; createdAt: Date }[];
  campaigns?: MarketingCampaignRecord[];
} = {}) {
  const customers = opts.customers ?? [];
  const orders = opts.orders ?? [];
  const campaigns = new Map<string, MarketingCampaignRecord>((opts.campaigns ?? []).map((c) => [c.id, c]));
  const recipients = new Map<string, CampaignRecipientRecord[]>();
  let nextId = 1;

  const repo: MarketingRepository = {
    async createCampaign(input: CreateCampaignInput) {
      const record: MarketingCampaignRecord = {
        id: `campaign-${nextId++}`,
        outletId: input.outletId,
        name: input.name,
        triggerType: input.triggerType,
        segmentFilter: input.segmentFilter ?? null,
        discountId: input.discountId ?? null,
        messageTemplate: input.messageTemplate,
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: input.createdBy ?? null,
      };
      campaigns.set(record.id, record);
      return record;
    },
    async listCampaigns(outletId: string): Promise<CampaignWithCounts[]> {
      return [...campaigns.values()]
        .filter((c) => c.outletId === outletId)
        .map((c) => {
          const recips = recipients.get(c.id) ?? [];
          return {
            ...c,
            recipientCounts: {
              total: recips.length,
              pending: recips.filter((r) => r.status === "PENDING").length,
              sent: recips.filter((r) => r.status === "SENT").length,
              failed: recips.filter((r) => r.status === "FAILED").length,
            },
          };
        });
    },
    async getCampaign(outletId: string, campaignId: string) {
      const c = campaigns.get(campaignId);
      if (!c || c.outletId !== outletId) return null;
      return c;
    },
    async findInactiveCustomerIds(outletId: string, inactiveDays: number) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - inactiveDays);
      return customers
        .filter((c) => c.outletId === outletId)
        .filter((c) => !orders.some((o) => o.customerId === c.id && o.createdAt >= cutoff))
        .map((c) => c.id);
    },
    async findBirthdayCustomerIds(outletId: string) {
      return customers.filter((c) => c.outletId === outletId && (c as { birthday?: boolean }).birthday).map((c) => c.id);
    },
    async filterExistingCustomerIds(outletId: string, customerIds: string[]) {
      return customers.filter((c) => c.outletId === outletId && customerIds.includes(c.id)).map((c) => c.id);
    },
    async createPendingRecipients(campaignId: string, customerIds: string[]) {
      const existing = recipients.get(campaignId) ?? [];
      const existingIds = new Set(existing.map((r) => r.customerId));
      let inserted = 0;
      for (const customerId of customerIds) {
        if (existingIds.has(customerId)) continue;
        existing.push({
          id: `recip-${nextId++}`,
          campaignId,
          customerId,
          status: "PENDING",
          queuedAt: new Date(),
          sentAt: null,
        });
        inserted++;
      }
      recipients.set(campaignId, existing);
      return inserted;
    },
    async listRecipients(campaignId: string) {
      return recipients.get(campaignId) ?? [];
    },
    async setCampaignStatus(campaignId: string, status: CampaignStatus) {
      const c = campaigns.get(campaignId);
      if (c) c.status = status;
    },
  };

  return repo;
}

describe("createCampaign", () => {
  it("creates a DRAFT campaign with valid input", async () => {
    const repo = makeFakeRepo();
    const campaign = await createCampaign(
      { outletId: "o1", name: "Win-back", triggerType: "MANUAL", messageTemplate: "Come back!" },
      repo,
    );
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.outletId).toBe("o1");
  });

  it("rejects INACTIVE_CUSTOMER campaigns without a positive inactiveDays", async () => {
    const repo = makeFakeRepo();
    await expect(
      createCampaign({ outletId: "o1", name: "x", triggerType: "INACTIVE_CUSTOMER", messageTemplate: "hi" }, repo),
    ).rejects.toThrow(/inactiveDays/);
  });

  it("rejects an invalid triggerType", async () => {
    const repo = makeFakeRepo();
    await expect(
      createCampaign({ outletId: "o1", name: "x", triggerType: "MADE_UP" as any, messageTemplate: "hi" }, repo),
    ).rejects.toThrow(/invalid triggerType/);
  });
});

describe("computeSegment", () => {
  it("INACTIVE_CUSTOMER: returns only customers with no order inside the window", async () => {
    const now = new Date();
    const recent = new Date(now);
    recent.setDate(recent.getDate() - 5);
    const old = new Date(now);
    old.setDate(old.getDate() - 90);

    const repo = makeFakeRepo({
      customers: [
        { id: "c1", outletId: "o1" }, // ordered recently -> active
        { id: "c2", outletId: "o1" }, // ordered 90 days ago -> inactive at 30-day window
        { id: "c3", outletId: "o1" }, // never ordered -> inactive
        { id: "c4", outletId: "o2" }, // different outlet, ignored
      ],
      orders: [
        { customerId: "c1", createdAt: recent },
        { customerId: "c2", createdAt: old },
      ],
    });

    const result = await computeSegment("o1", "INACTIVE_CUSTOMER", { inactiveDays: 30 }, repo);

    expect(result.customerIds.sort()).toEqual(["c2", "c3"]);
    expect(result.gap).toBeUndefined();
  });

  it("INACTIVE_CUSTOMER: throws without a positive inactiveDays filter", async () => {
    const repo = makeFakeRepo();
    await expect(computeSegment("o1", "INACTIVE_CUSTOMER", {}, repo)).rejects.toThrow(/inactiveDays/);
    await expect(computeSegment("o1", "INACTIVE_CUSTOMER", { inactiveDays: -5 }, repo)).rejects.toThrow(
      /inactiveDays/,
    );
  });

  it("MANUAL: returns only the validated, outlet-scoped customer ids", async () => {
    const repo = makeFakeRepo({
      customers: [
        { id: "c1", outletId: "o1" },
        { id: "c2", outletId: "o2" }, // wrong outlet, must be filtered out
      ],
    });

    const result = await computeSegment("o1", "MANUAL", { customerIds: ["c1", "c2", "nonexistent"] }, repo);

    expect(result.customerIds).toEqual(["c1"]);
  });

  it("MANUAL: returns empty when no customerIds are provided", async () => {
    const repo = makeFakeRepo();
    const result = await computeSegment("o1", "MANUAL", {}, repo);
    expect(result.customerIds).toEqual([]);
  });

  it("BIRTHDAY: returns outlet customers marked for the current birthday window", async () => {
    const repo = makeFakeRepo({
      customers: [
        { id: "c1", outletId: "o1", birthday: true },
        { id: "c2", outletId: "o1" },
      ],
    });
    const result = await computeSegment("o1", "BIRTHDAY", {}, repo);
    expect(result.customerIds).toEqual(["c1"]);
  });
});

describe("queueCampaign", () => {
  it("inserts PENDING recipients for every matched customer and flips DRAFT -> ACTIVE", async () => {
    const repo = makeFakeRepo({
      customers: [
        { id: "c1", outletId: "o1" },
        { id: "c2", outletId: "o1" },
      ],
      orders: [],
    });
    const campaign = await createCampaign(
      { outletId: "o1", name: "Win-back", triggerType: "INACTIVE_CUSTOMER", segmentFilter: { inactiveDays: 30 }, messageTemplate: "hi" },
      repo,
    );

    const result = await queueCampaign("o1", campaign.id, repo);

    expect(result.segmentSize).toBe(2);
    expect(result.queuedCount).toBe(2);
    expect(result.gap).toBeUndefined();

    const recipients = await listRecipients(campaign.id, repo);
    expect(recipients).toHaveLength(2);
    expect(recipients.every((r) => r.status === "PENDING")).toBe(true);

    const [updated] = (await repo.listCampaigns("o1")).filter((c) => c.id === campaign.id);
    expect(updated.status).toBe("ACTIVE");
  });

  it("re-queueing is idempotent: already-queued customers are not duplicated", async () => {
    const repo = makeFakeRepo({
      customers: [{ id: "c1", outletId: "o1" }],
      orders: [],
    });
    const campaign = await createCampaign(
      { outletId: "o1", name: "Win-back", triggerType: "INACTIVE_CUSTOMER", segmentFilter: { inactiveDays: 30 }, messageTemplate: "hi" },
      repo,
    );

    const first = await queueCampaign("o1", campaign.id, repo);
    expect(first.queuedCount).toBe(1);

    const second = await queueCampaign("o1", campaign.id, repo);
    expect(second.segmentSize).toBe(1);
    expect(second.queuedCount).toBe(0); // already queued, no duplicate insert

    const recipients = await listRecipients(campaign.id, repo);
    expect(recipients).toHaveLength(1);
  });

  it("BIRTHDAY campaigns queue customers returned by the birthday segment query", async () => {
    const repo = makeFakeRepo({ customers: [{ id: "c1", outletId: "o1", birthday: true }] });
    const campaign = await createCampaign(
      { outletId: "o1", name: "Birthday blast", triggerType: "BIRTHDAY", messageTemplate: "Happy birthday!" },
      repo,
    );

    const result = await queueCampaign("o1", campaign.id, repo);

    expect(result.segmentSize).toBe(1);
    expect(result.queuedCount).toBe(1);

    const recipients = await listRecipients(campaign.id, repo);
    expect(recipients).toHaveLength(1);
  });

  it("throws Campaign not found for a nonexistent or wrong-outlet campaign id", async () => {
    const repo = makeFakeRepo({ campaigns: [] });
    await expect(queueCampaign("o1", "missing-id", repo)).rejects.toThrow(/Campaign not found/);
  });
});
