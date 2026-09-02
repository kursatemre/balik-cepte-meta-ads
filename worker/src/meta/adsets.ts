/**
 * Ad Set seviyesinde yonetim - campaigns.ts'deki create akisinin urettigi
 * ad set'leri sonradan listelemek/kontrol etmek icin.
 *
 * ONEMLI: Bu proje butceyi HER ZAMAN ad-set seviyesinde ayarliyor (CBO
 * kullanilmiyor, bkz. campaigns.ts is_adset_budget_sharing_enabled).
 * campaigns.ts'deki campaign_set_budget SADECE kampanya (CBO) butcesini
 * degistirir - bizim olusturdugumuz kampanyalarda hicbir etkisi olmaz.
 * Gercek butce degisikligi icin setAdSetBudget kullanilmali.
 */
import { adAccountPath, graphRequest, graphRequestPaged, type MetaEnv } from "./client";

const FIELDS = ["id", "name", "status", "daily_budget", "optimization_goal", "campaign_id"].join(",");

function tryToCents(tryAmount: number): number {
  return Math.round(tryAmount * 100);
}

export async function listAdSets(
  env: MetaEnv,
  opts: { campaignId?: string; status?: string[]; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const params: Record<string, unknown> = { fields: FIELDS, limit: opts.limit ?? 50 };
  if (opts.status?.length) params.effective_status = opts.status;
  const path = opts.campaignId ? `/${opts.campaignId}/adsets` : adAccountPath(env, "adsets");
  return await graphRequestPaged(env, path, params);
}

export async function getAdSetStatus(env: MetaEnv, adsetId: string): Promise<Record<string, unknown>> {
  return await graphRequest(env, `/${adsetId}`, { params: { fields: FIELDS } });
}

export async function pauseAdSet(env: MetaEnv, adsetId: string): Promise<void> {
  await graphRequest(env, `/${adsetId}`, { method: "POST", params: { status: "PAUSED" } });
}

/** DIKKAT: Ad set'i ACTIVE yapar, harcama baslar. Tool katmani onay ister. */
export async function resumeAdSet(env: MetaEnv, adsetId: string): Promise<void> {
  await graphRequest(env, `/${adsetId}`, { method: "POST", params: { status: "ACTIVE" } });
}

export async function setAdSetBudget(env: MetaEnv, adsetId: string, dailyBudgetTry: number): Promise<void> {
  await graphRequest(env, `/${adsetId}`, {
    method: "POST",
    params: { daily_budget: tryToCents(dailyBudgetTry) },
  });
}
