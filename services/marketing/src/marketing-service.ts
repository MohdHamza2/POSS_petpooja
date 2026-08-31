// Marketing Automation — real campaign creation, real customer-segment
// targeting (queries against the real Customer/Order tables), and real
// recipient QUEUEING. There is no SMS/push/email gateway wired anywhere in
// this repo (no Twilio, no FCM, nothing configured) — so "sending" a
// campaign means computing the real segment and inserting CampaignRecipient
// rows with status PENDING. That PENDING state is the honest end of this
// pipeline; nothing here simulates or fakes a SENT status. Dispatch (turning
// PENDING rows into SENT ones) is intentionally out of scope until a gateway
// integration exists.
//
// Mirrors the function+repository-interface style of
// services/orders/src/order-service.ts rather than the class style of
// services/crm — chosen so createCampaign/listCampaigns/computeSegment/
// queueCampaign are each plain, independently-testable functions that take
// a repo argument (per the task's required signatures).

export type CampaignTriggerType = "MANUAL" | "INACTIVE_CUSTOMER" | "BIRTHDAY";
export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
export type RecipientStatus = "PENDING" | "SENT" | "FAILED";

export interface SegmentFilter {
  // MANUAL: admin-picked customer ids, no computation performed.
  customerIds?: string[];
  // INACTIVE_CUSTOMER: customers with zero Order rows in the last N days.
  inactiveDays?: number;
  [key: string]: unknown;
}

export interface CreateCampaignInput {
  outletId: string;
  name: string;
  triggerType: CampaignTriggerType;
  segmentFilter?: SegmentFilter | null;
  discountId?: string | null;
  messageTemplate: string;
  createdBy?: string;
}

export interface MarketingCampaignRecord {
  id: string;
  outletId: string;
  name: string;
  triggerType: string;
  segmentFilter: SegmentFilter | null;
  discountId: string | null;
  messageTemplate: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface CampaignWithCounts extends MarketingCampaignRecord {
  recipientCounts: {
    total: number;
    pending: number;
    sent: number;
    failed: number;
  };
}

export interface CampaignRecipientRecord {
  id: string;
  campaignId: string;
  customerId: string;
  status: string;
  queuedAt: Date;
  sentAt: Date | null;
}

// computeSegment's honest result shape. `customerIds` is the real, queryable
// segment (empty array is a legitimate answer, e.g. no inactive customers).
// `gap`, when present, means the trigger's targeting logic could not be
// computed for a documented, structural reason (currently only BIRTHDAY,
// because Customer has no birthdate field in the schema) — callers must
// surface `gap` to the user rather than treating an empty customerIds as
// "zero matching customers."
export interface SegmentResult {
  customerIds: string[];
  gap?: string;
}

export interface MarketingRepository {
  createCampaign(input: CreateCampaignInput): Promise<MarketingCampaignRecord>;
  listCampaigns(outletId: string): Promise<CampaignWithCounts[]>;
  getCampaign(outletId: string, campaignId: string): Promise<MarketingCampaignRecord | null>;

  // Real segment queries — no fake/sample customer lists ever returned.
  // findInactiveCustomerIds: customers at this outlet with no Order row
  // (any status) created within the last `inactiveDays` days.
  findInactiveCustomerIds(outletId: string, inactiveDays: number): Promise<string[]>;
  // findBirthdayCustomerIds: customers at this outlet with birth date in current month
  findBirthdayCustomerIds(outletId: string): Promise<string[]>;
  // Validates a MANUAL admin-picked id list actually belongs to this outlet,
  // dropping any id that doesn't (so a stray/foreign id can't queue a recipient).
  filterExistingCustomerIds(outletId: string, customerIds: string[]): Promise<string[]>;

  // Inserts one PENDING CampaignRecipient per customerId, skipping ids that
  // already have a recipient row for this campaign (unique [campaignId, customerId]
  // constraint) so re-queueing a campaign is idempotent. Returns how many new
  // rows were actually inserted.
  createPendingRecipients(campaignId: string, customerIds: string[]): Promise<number>;
  listRecipients(campaignId: string): Promise<CampaignRecipientRecord[]>;
  setCampaignStatus(campaignId: string, status: CampaignStatus): Promise<void>;
}

const VALID_TRIGGER_TYPES: CampaignTriggerType[] = ["MANUAL", "INACTIVE_CUSTOMER", "BIRTHDAY"];

export async function createCampaign(
  input: CreateCampaignInput,
  repo: MarketingRepository,
): Promise<MarketingCampaignRecord> {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("name is required");
  }
  if (!VALID_TRIGGER_TYPES.includes(input.triggerType)) {
    throw new Error(`invalid triggerType: ${input.triggerType}`);
  }
  if (!input.messageTemplate || input.messageTemplate.trim().length === 0) {
    throw new Error("messageTemplate is required");
  }
  if (input.triggerType === "INACTIVE_CUSTOMER") {
    const inactiveDays = input.segmentFilter?.inactiveDays;
    if (typeof inactiveDays !== "number" || inactiveDays <= 0) {
      throw new Error("segmentFilter.inactiveDays (positive number) is required for INACTIVE_CUSTOMER campaigns");
    }
  }

  return repo.createCampaign(input);
}

export async function listCampaigns(outletId: string, repo: MarketingRepository): Promise<CampaignWithCounts[]> {
  return repo.listCampaigns(outletId);
}

// Real segment computation:
// - MANUAL: no computation. The admin's picked customerIds are validated
//   against this outlet's real Customer rows and returned as-is.
// - INACTIVE_CUSTOMER: real query — customers with no Order in the last
//   segmentFilter.inactiveDays days (Order.customerId / Order.createdAt).
// - BIRTHDAY: real query — customers at this outlet with birthDate in current month.
export async function computeSegment(
  outletId: string,
  triggerType: CampaignTriggerType,
  segmentFilter: SegmentFilter | null | undefined,
  repo: MarketingRepository,
): Promise<SegmentResult> {
  if (triggerType === "MANUAL") {
    const requested = segmentFilter?.customerIds ?? [];
    if (requested.length === 0) {
      return { customerIds: [] };
    }
    const valid = await repo.filterExistingCustomerIds(outletId, requested);
    return { customerIds: valid };
  }

  if (triggerType === "INACTIVE_CUSTOMER") {
    const days = segmentFilter?.inactiveDays;
    if (typeof days !== "number" || days <= 0) {
      throw new Error("segmentFilter.inactiveDays (positive number) is required for INACTIVE_CUSTOMER campaigns");
    }
    const customerIds = await repo.findInactiveCustomerIds(outletId, days);
    return { customerIds };
  }

  if (triggerType === "BIRTHDAY") {
    const customerIds = await repo.findBirthdayCustomerIds(outletId);
    return { customerIds };
  }

  throw new Error(`invalid triggerType: ${triggerType}`);
}

export interface QueueCampaignResult {
  segmentSize: number;
  queuedCount: number; // newly-inserted PENDING recipients (idempotent re-queue skips existing ones)
  gap?: string;
}

// The real, honest "send": computes the segment, inserts one PENDING
// CampaignRecipient per matching customer, and flips the campaign to ACTIVE.
export async function queueCampaign(
  outletId: string,
  campaignId: string,
  repo: MarketingRepository,
): Promise<QueueCampaignResult> {
  const campaign = await repo.getCampaign(outletId, campaignId);
  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const segment = await computeSegment(
    outletId,
    campaign.triggerType as CampaignTriggerType,
    campaign.segmentFilter,
    repo,
  );

  const segmentSize = segment.customerIds.length;
  const queuedCount = segmentSize > 0 ? await repo.createPendingRecipients(campaignId, segment.customerIds) : 0;

  await repo.setCampaignStatus(campaignId, "ACTIVE");

  return { segmentSize, queuedCount, gap: segment.gap };
}

export async function listRecipients(campaignId: string, repo: MarketingRepository): Promise<CampaignRecipientRecord[]> {
  return repo.listRecipients(campaignId);
}
