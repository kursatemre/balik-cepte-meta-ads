/** Google Ads targeting keyword (AdGroupCriterion) yonetimi. */
import { gadsMutate, gadsSearch, requireCustomerId, toMicros, type GadsEnv } from "./client";

export interface CreateKeywordInput {
  text: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  cpcBid?: number;
}

export async function createKeywords(
  env: GadsEnv,
  adGroupId: string,
  keywords: CreateKeywordInput[],
): Promise<Record<string, unknown>[]> {
  const customerId = requireCustomerId(env);
  const operations = keywords.map((k) => ({
    create: {
      adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
      status: "ENABLED",
      keyword: { text: k.text, matchType: k.matchType },
      ...(k.cpcBid ? { cpcBidMicros: toMicros(k.cpcBid) } : {}),
    },
  }));
  return await gadsMutate(env, customerId, "adGroupCriteria", operations);
}

export async function listKeywords(env: GadsEnv, adGroupId: string): Promise<Record<string, unknown>[]> {
  const customerId = requireCustomerId(env);
  const query =
    "SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, " +
    "ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion " +
    `WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group.id = ${Number(adGroupId)}`;
  const rows = await gadsSearch(env, customerId, query);
  return rows.map((r: any) => ({
    id: r.adGroupCriterion?.criterionId,
    text: r.adGroupCriterion?.keyword?.text,
    match_type: r.adGroupCriterion?.keyword?.matchType,
    status: r.adGroupCriterion?.status,
  }));
}

export async function pauseKeyword(env: GadsEnv, adGroupId: string, criterionId: string): Promise<void> {
  const customerId = requireCustomerId(env);
  await gadsMutate(env, customerId, "adGroupCriteria", [
    {
      update: {
        resourceName: `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`,
        status: "PAUSED",
      },
      updateMask: "status",
    },
  ]);
}

export async function deleteKeyword(env: GadsEnv, adGroupId: string, criterionId: string): Promise<void> {
  const customerId = requireCustomerId(env);
  await gadsMutate(env, customerId, "adGroupCriteria", [
    { remove: `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}` },
  ]);
}
