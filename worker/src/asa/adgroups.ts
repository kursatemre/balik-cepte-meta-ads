/**
 * ASA ad group yonetimi. Endpoint'ler kampanya altinda nest'li:
 * /campaigns/{campaignId}/adgroups/...
 *
 * NOT: Tam alan gereksinimleri (targeting dimensions vb.) bu oturumda canli
 * test edilerek dogrulanmadi (hesapta mevcut ad group yoktu) - ilk gercek
 * createPausedAdGroup cagrisinda Apple'in donduregi hata mesaji (AsaApiError,
 * field bazinda) rehber alinip gerekirse payload guncellenmeli (Meta
 * entegrasyonunda ayni sekilde iteratif duzeltildi).
 */
import { asaRequest, type AsaEnv } from "./client";

export interface CreateAsaAdGroupInput {
  campaignId: string;
  name: string;
  defaultBidAmount: number;
  currency?: string;
  cpaGoal?: number;
}

const DEFAULT_CURRENCY = "USD";

export async function createPausedAdGroup(env: AsaEnv, input: CreateAsaAdGroupInput): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    name: input.name,
    status: "PAUSED",
    startTime: new Date().toISOString(),
    defaultBidAmount: { amount: String(input.defaultBidAmount), currency: input.currency ?? DEFAULT_CURRENCY },
    pricingModel: "CPC",
    automatedKeywordsOptIn: false,
  };
  if (input.cpaGoal) {
    body.cpaGoal = { amount: String(input.cpaGoal), currency: input.currency ?? DEFAULT_CURRENCY };
  }
  const result = await asaRequest(env, `/campaigns/${input.campaignId}/adgroups`, { method: "POST", body });
  return result.data;
}

export async function listAdGroups(env: AsaEnv, campaignId: string, opts: { limit?: number } = {}): Promise<Record<string, unknown>[]> {
  const result = await asaRequest(env, `/campaigns/${campaignId}/adgroups`, { query: { limit: opts.limit ?? 100 } });
  return result.data ?? [];
}

export async function getAdGroupStatus(env: AsaEnv, campaignId: string, adGroupId: string): Promise<Record<string, unknown>> {
  const result = await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}`);
  return result.data;
}

export async function pauseAdGroup(env: AsaEnv, campaignId: string, adGroupId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}`, {
    method: "PUT",
    body: { adGroup: { status: "PAUSED" } },
  });
}

/** DIKKAT: Ad group'u ENABLED yapar, harcama baslayabilir. Tool katmani onay ister. */
export async function resumeAdGroup(env: AsaEnv, campaignId: string, adGroupId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}`, {
    method: "PUT",
    body: { adGroup: { status: "ENABLED" } },
  });
}

export async function setAdGroupBid(
  env: AsaEnv,
  campaignId: string,
  adGroupId: string,
  defaultBidAmount: number,
  currency: string = DEFAULT_CURRENCY,
): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}`, {
    method: "PUT",
    body: { adGroup: { defaultBidAmount: { amount: String(defaultBidAmount), currency } } },
  });
}
