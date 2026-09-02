/** Google Ads ad group yonetimi. */
import { fromMicros, gadsMutate, gadsSearch, requireCustomerId, toMicros, type GadsEnv } from "./client";

export interface CreateGadsAdGroupInput {
  campaignId: string;
  name: string;
  cpcBid: number;
}

export async function createPausedAdGroup(env: GadsEnv, input: CreateGadsAdGroupInput): Promise<Record<string, unknown>> {
  const customerId = requireCustomerId(env);
  const results = await gadsMutate(env, customerId, "adGroups", [
    {
      create: {
        name: input.name,
        campaign: `customers/${customerId}/campaigns/${input.campaignId}`,
        status: "PAUSED",
        type: "SEARCH_STANDARD",
        cpcBidMicros: toMicros(input.cpcBid),
      },
    },
  ]);
  const resourceName = results[0]?.resourceName as string;
  if (!resourceName) throw new Error("Ad group olusturulamadi - beklenmeyen yanit.");
  return { resource_name: resourceName, status: "PAUSED" };
}

export async function listAdGroups(env: GadsEnv, campaignId: string): Promise<Record<string, unknown>[]> {
  const customerId = requireCustomerId(env);
  const query =
    "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group " +
    `WHERE campaign.id = ${Number(campaignId)} ORDER BY ad_group.id`;
  const rows = await gadsSearch(env, customerId, query);
  return rows.map((r: any) => ({
    id: r.adGroup?.id,
    name: r.adGroup?.name,
    status: r.adGroup?.status,
    cpc_bid: r.adGroup?.cpcBidMicros ? fromMicros(r.adGroup.cpcBidMicros) : null,
  }));
}

export async function getAdGroupStatus(env: GadsEnv, adGroupId: string): Promise<Record<string, unknown>> {
  const customerId = requireCustomerId(env);
  const query =
    "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ad_group.campaign FROM ad_group " +
    `WHERE ad_group.id = ${Number(adGroupId)}`;
  const rows = await gadsSearch(env, customerId, query);
  const r: any = rows[0];
  if (!r) throw new Error(`Ad group bulunamadi: ${adGroupId}`);
  return {
    id: r.adGroup?.id,
    name: r.adGroup?.name,
    status: r.adGroup?.status,
    cpc_bid: r.adGroup?.cpcBidMicros ? fromMicros(r.adGroup.cpcBidMicros) : null,
    campaign: r.adGroup?.campaign,
  };
}

async function updateAdGroupStatus(env: GadsEnv, adGroupId: string, status: "PAUSED" | "ENABLED"): Promise<void> {
  const customerId = requireCustomerId(env);
  await gadsMutate(env, customerId, "adGroups", [
    { update: { resourceName: `customers/${customerId}/adGroups/${adGroupId}`, status }, updateMask: "status" },
  ]);
}

export async function pauseAdGroup(env: GadsEnv, adGroupId: string): Promise<void> {
  await updateAdGroupStatus(env, adGroupId, "PAUSED");
}

/** DIKKAT: Ad group'u ENABLED yapar, harcama baslayabilir. Tool katmani onay ister. */
export async function resumeAdGroup(env: GadsEnv, adGroupId: string): Promise<void> {
  await updateAdGroupStatus(env, adGroupId, "ENABLED");
}

export async function setAdGroupBid(env: GadsEnv, adGroupId: string, cpcBid: number): Promise<void> {
  const customerId = requireCustomerId(env);
  await gadsMutate(env, customerId, "adGroups", [
    {
      update: { resourceName: `customers/${customerId}/adGroups/${adGroupId}`, cpcBidMicros: toMicros(cpcBid) },
      updateMask: "cpc_bid_micros",
    },
  ]);
}
