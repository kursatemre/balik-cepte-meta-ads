/** ASA targeting keyword yonetimi - /campaigns/{campaignId}/adgroups/{adGroupId}/targetingkeywords */
import { asaRequest, type AsaEnv } from "./client";

const DEFAULT_CURRENCY = "USD";

export interface CreateKeywordInput {
  text: string;
  matchType: "EXACT" | "BROAD";
  bidAmount?: number;
  currency?: string;
}

export async function createKeywords(
  env: AsaEnv,
  campaignId: string,
  adGroupId: string,
  keywords: CreateKeywordInput[],
): Promise<Record<string, unknown>[]> {
  const body = keywords.map((k) => ({
    text: k.text,
    matchType: k.matchType,
    status: "ACTIVE",
    ...(k.bidAmount ? { bidAmount: { amount: String(k.bidAmount), currency: k.currency ?? DEFAULT_CURRENCY } } : {}),
  }));
  const result = await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`, {
    method: "POST",
    body,
  });
  return result.data ?? [];
}

export async function listKeywords(
  env: AsaEnv,
  campaignId: string,
  adGroupId: string,
  opts: { limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const result = await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords`, {
    query: { limit: opts.limit ?? 100 },
  });
  return result.data ?? [];
}

export async function pauseKeyword(env: AsaEnv, campaignId: string, adGroupId: string, keywordId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/${keywordId}`, {
    method: "PUT",
    body: { targetingKeyword: { status: "PAUSED" } },
  });
}

export async function deleteKeyword(env: AsaEnv, campaignId: string, adGroupId: string, keywordId: string): Promise<void> {
  await asaRequest(env, `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/${keywordId}`, {
    method: "DELETE",
  });
}
