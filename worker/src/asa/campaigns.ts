/**
 * ASA kampanya yonetimi. PUT ucu partial update icin body'yi {"campaign":{...}}
 * seklinde sarmali bekliyor (Meta'nin duz obje beklemesinden farkli - Apple'in
 * kendi dokumaninda dogrulanan format).
 */
import { asaRequest, type AsaEnv } from "./client";

export interface CreateAsaCampaignInput {
  name: string;
  dailyBudgetAmount: number;
  currency?: string;
  adamId: string;
  countriesOrRegions?: string[];
  billingEvent?: string;
}

const DEFAULT_COUNTRIES = ["TR"];
const DEFAULT_CURRENCY = "USD";
const DEFAULT_BILLING_EVENT = "TAPS";

export async function createPausedCampaign(env: AsaEnv, input: CreateAsaCampaignInput): Promise<Record<string, unknown>> {
  const body = {
    orgId: Number(env.ASA_ORG_ID),
    adChannelType: "SEARCH",
    supplySources: ["APPSTORE_SEARCH_RESULTS"],
    billingEvent: input.billingEvent ?? DEFAULT_BILLING_EVENT,
    name: input.name,
    dailyBudgetAmount: {
      amount: String(input.dailyBudgetAmount),
      currency: input.currency ?? DEFAULT_CURRENCY,
    },
    adamId: Number(input.adamId),
    countriesOrRegions: input.countriesOrRegions ?? DEFAULT_COUNTRIES,
    status: "PAUSED",
  };
  const result = await asaRequest(env, "/campaigns", { method: "POST", body });
  return result.data;
}

export async function listCampaigns(env: AsaEnv, opts: { limit?: number } = {}): Promise<Record<string, unknown>[]> {
  const result = await asaRequest(env, "/campaigns", { query: { limit: opts.limit ?? 100 } });
  return result.data ?? [];
}

export async function getCampaignStatus(env: AsaEnv, campaignId: string): Promise<Record<string, unknown>> {
  const result = await asaRequest(env, `/campaigns/${campaignId}`);
  return result.data;
}

export async function pauseCampaign(env: AsaEnv, campaignId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}`, { method: "PUT", body: { campaign: { status: "PAUSED" } } });
}

/** DIKKAT: Kampanyayi ENABLED yapar, harcama baslar. Tool katmani onay ister. */
export async function resumeCampaign(env: AsaEnv, campaignId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}`, { method: "PUT", body: { campaign: { status: "ENABLED" } } });
}

export async function setCampaignBudget(
  env: AsaEnv,
  campaignId: string,
  dailyBudgetAmount: number,
  currency: string = DEFAULT_CURRENCY,
): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}`, {
    method: "PUT",
    body: { campaign: { dailyBudgetAmount: { amount: String(dailyBudgetAmount), currency } } },
  });
}

/** DIKKAT: Kalicidir. Tool katmani sadece PAUSED kampanyalar icin ve onayla izin verir. */
export async function deleteCampaign(env: AsaEnv, campaignId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}`, { method: "DELETE" });
}
