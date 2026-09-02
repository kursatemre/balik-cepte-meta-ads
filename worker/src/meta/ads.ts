/** Ad (reklam) seviyesinde yonetim + preview. */
import { adAccountPath, graphRequest, graphRequestPaged, type MetaEnv } from "./client";

const FIELDS = ["id", "name", "status", "adset_id", "campaign_id"].join(",");

const DEFAULT_AD_FORMAT = "MOBILE_FEED_STANDARD";

export async function listAds(
  env: MetaEnv,
  opts: { adsetId?: string; campaignId?: string; status?: string[]; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const params: Record<string, unknown> = { fields: FIELDS, limit: opts.limit ?? 50 };
  if (opts.status?.length) params.effective_status = opts.status;
  const path = opts.adsetId
    ? `/${opts.adsetId}/ads`
    : opts.campaignId
      ? `/${opts.campaignId}/ads`
      : adAccountPath(env, "ads");
  return await graphRequestPaged(env, path, params);
}

export async function getAdStatus(env: MetaEnv, adId: string): Promise<Record<string, unknown>> {
  return await graphRequest(env, `/${adId}`, { params: { fields: FIELDS } });
}

export async function pauseAd(env: MetaEnv, adId: string): Promise<void> {
  await graphRequest(env, `/${adId}`, { method: "POST", params: { status: "PAUSED" } });
}

/** DIKKAT: Reklami ACTIVE yapar, harcama baslar. Tool katmani onay ister. */
export async function resumeAd(env: MetaEnv, adId: string): Promise<void> {
  await graphRequest(env, `/${adId}`, { method: "POST", params: { status: "ACTIVE" } });
}

/**
 * Mevcut bir reklamin gercekte nasil gorunecegini (HTML/iframe) getirir -
 * ACTIVE etmeden once gorsel QA icin. ad_format ornekleri: MOBILE_FEED_STANDARD,
 * DESKTOP_FEED_STANDARD, INSTAGRAM_STANDARD, INSTAGRAM_STORY.
 */
export async function previewAd(
  env: MetaEnv,
  adId: string,
  adFormat: string = DEFAULT_AD_FORMAT,
): Promise<unknown> {
  const result = await graphRequest(env, `/${adId}/previews`, { params: { ad_format: adFormat } });
  return result.data ?? result;
}
