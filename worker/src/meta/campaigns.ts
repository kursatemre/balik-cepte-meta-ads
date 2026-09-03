/**
 * Kampanya / ad set / reklam olusturma ve mevcut kampanya yonetimi.
 * meta_ads/campaigns.py'nin portu.
 *
 * GUVENLIK KURALI: `createPausedCampaign` her zaman PAUSED durumda kampanya/
 * adset/reklam olusturur. ACTIVE'e gecis bu dosyada YOK - MCP tool katmani
 * (src/mcp-agent.ts) resume icin ayri bir preview+confirm_token akisi
 * kullaniyor, tek cagriyla asla harcama baslamaz.
 *
 * Asagidaki sabitler bu oturumda (2026-09-01/02) gercek Meta API'ye karsi
 * canli test edilerek bulundu - Meta bunlari artik zorunlu kiliyor:
 *   - is_adset_budget_sharing_enabled: false  (CBO kullanilmiyorsa sart)
 *   - bid_strategy: LOWEST_COST_WITHOUT_CAP    (teklif stratejisi artik acik olmali)
 *   - targeting.user_os: ["iOS"]               (object_store_url iOS'a isaret ediyorsa sart)
 * Ayrica: minimum ad-set gunluk butcesi hesaba gore degisir (bu oturumda
 * act_244832992826003 icin ~48.23 TRY idi) - dusuk deger acik bir hata doner.
 */
import { adAccountPath, graphRequest, graphRequestPaged, type MetaEnv } from "./client";
import { ensureAudienceReady } from "./audiences";
import { buildCreativeForType, type ImageInput } from "./creatives";

export const DEFAULT_OBJECTIVE = "OUTCOME_APP_PROMOTION";
export const DEFAULT_OPTIMIZATION_GOAL = "APP_INSTALLS";
export const DEFAULT_BILLING_EVENT = "IMPRESSIONS";
export const DEFAULT_COUNTRIES = ["TR"];

function tryToCents(tryAmount: number): number {
  return Math.round(tryAmount * 100);
}

export function buildCampaignPayload(opts: { name: string; objective?: string }) {
  return {
    name: opts.name,
    objective: opts.objective ?? DEFAULT_OBJECTIVE,
    status: "PAUSED",
    special_ad_categories: [] as string[],
    is_adset_budget_sharing_enabled: false,
  };
}

export function buildAdSetPayload(opts: {
  name: string;
  campaignId: string;
  dailyBudgetTry: number;
  audienceId?: string;
  appId: string;
  appStoreUrl: string;
  optimizationGoal?: string;
  billingEvent?: string;
  countries?: string[];
  customEventType?: string;
}) {
  const promotedObject: Record<string, unknown> = {
    application_id: opts.appId,
    object_store_url: opts.appStoreUrl,
  };
  if (opts.customEventType) promotedObject.custom_event_type = opts.customEventType;

  const targeting: Record<string, unknown> = {
    geo_locations: { countries: opts.countries ?? DEFAULT_COUNTRIES },
    user_os: ["iOS"],
  };
  // audience_id verilmezse Meta'nin genis/Advantage+ hedeflemesine birakilir
  // (orn. mevcut "claude TOF" kampanyasi da custom_audiences kullanmiyor).
  if (opts.audienceId) {
    targeting.custom_audiences = [{ id: opts.audienceId }];
  }

  return {
    name: opts.name,
    campaign_id: opts.campaignId,
    daily_budget: tryToCents(opts.dailyBudgetTry),
    billing_event: opts.billingEvent ?? DEFAULT_BILLING_EVENT,
    optimization_goal: opts.optimizationGoal ?? DEFAULT_OPTIMIZATION_GOAL,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    status: "PAUSED",
    promoted_object: promotedObject,
    targeting,
  };
}

export function buildAdPayload(opts: { name: string; adsetId: string; creativeId: string }) {
  return {
    name: opts.name,
    adset_id: opts.adsetId,
    creative: { creative_id: opts.creativeId },
    status: "PAUSED",
  };
}

export interface CreateCampaignInput {
  name: string;
  dailyBudgetTry: number;
  /** Verilmezse Meta'nin genis/Advantage+ hedeflemesine birakilir (custom audience kullanilmaz). */
  audienceId?: string;
  appId: string;
  appStoreUrl: string;
  pageId: string;
  link: string;
  creativeType: "single" | "carousel" | "video";
  images?: ImageInput[];
  video?: ImageInput;
  thumbnail?: ImageInput;
  headlines: string[];
  descriptions?: string[];
  message?: string;
  objective?: string;
  optimizationGoal?: string;
  billingEvent?: string;
  countries?: string[];
  customEventType?: string;
  dryRun?: boolean;
}

export async function createPausedCampaign(
  env: MetaEnv & { CREATIVES?: R2Bucket },
  input: CreateCampaignInput,
) {
  if (!["single", "carousel", "video"].includes(input.creativeType)) {
    throw new Error("creative_type 'single', 'carousel' ya da 'video' olmali.");
  }

  // Kitle hazir degilse burada durur - hicbir yazma cagrisi yapilmadan once.
  // audience_id verilmezse bu kontrol atlanir (genis/Advantage+ hedefleme).
  if (input.audienceId) {
    await ensureAudienceReady(env, input.audienceId);
  }

  const campaignPayload = buildCampaignPayload({ name: input.name, objective: input.objective });
  const adsetPreview = buildAdSetPayload({
    name: `${input.name} - adset`,
    campaignId: "<olusturulacak>",
    dailyBudgetTry: input.dailyBudgetTry,
    audienceId: input.audienceId,
    appId: input.appId,
    appStoreUrl: input.appStoreUrl,
    optimizationGoal: input.optimizationGoal,
    billingEvent: input.billingEvent,
    countries: input.countries,
    customEventType: input.customEventType,
  });

  const plan = {
    campaign: campaignPayload,
    adset: adsetPreview,
    creative_type: input.creativeType,
    images: input.images,
    headlines: input.headlines,
    descriptions: input.descriptions ?? null,
    link: input.link,
    page_id: input.pageId,
  };

  if (input.dryRun) {
    return { dry_run: true, plan };
  }

  const campaign = await graphRequest(env, adAccountPath(env, "campaigns"), {
    method: "POST",
    params: campaignPayload,
  });
  const campaignId = campaign.id as string;

  const adsetPayload = buildAdSetPayload({
    name: `${input.name} - adset`,
    campaignId,
    dailyBudgetTry: input.dailyBudgetTry,
    audienceId: input.audienceId,
    appId: input.appId,
    appStoreUrl: input.appStoreUrl,
    optimizationGoal: input.optimizationGoal,
    billingEvent: input.billingEvent,
    countries: input.countries,
    customEventType: input.customEventType,
  });
  const adset = await graphRequest(env, adAccountPath(env, "adsets"), {
    method: "POST",
    params: adsetPayload,
  });
  const adsetId = adset.id as string;

  const creativePayload = await buildCreativeForType(env, {
    creativeType: input.creativeType,
    images: input.images,
    video: input.video,
    thumbnail: input.thumbnail,
    headlines: input.headlines,
    descriptions: input.descriptions,
    message: input.message,
    link: input.link,
    pageId: input.pageId,
  });

  const creative = await graphRequest(env, adAccountPath(env, "adcreatives"), {
    method: "POST",
    params: creativePayload,
  });
  const creativeId = creative.id as string;

  const adPayload = buildAdPayload({ name: `${input.name} - ad`, adsetId, creativeId });
  const ad = await graphRequest(env, adAccountPath(env, "ads"), {
    method: "POST",
    params: adPayload,
  });

  return {
    dry_run: false,
    campaign_id: campaignId,
    adset_id: adsetId,
    creative_id: creativeId,
    ad_id: ad.id as string,
    status: "PAUSED" as const,
  };
}

export async function listCampaigns(
  env: MetaEnv,
  opts: { status?: string[]; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const fields = ["id", "name", "status", "objective", "daily_budget"].join(",");
  const params: Record<string, unknown> = { fields, limit: opts.limit ?? 50 };
  if (opts.status?.length) params.effective_status = opts.status;
  return await graphRequestPaged(env, adAccountPath(env, "campaigns"), params);
}

export async function pauseCampaign(env: MetaEnv, campaignId: string): Promise<void> {
  await graphRequest(env, `/${campaignId}`, { method: "POST", params: { status: "PAUSED" } });
}

/** DIKKAT: Bu kampanyayi ACTIVE yapar, harcama baslar. Tool katmani onay ister. */
export async function resumeCampaign(env: MetaEnv, campaignId: string): Promise<void> {
  await graphRequest(env, `/${campaignId}`, { method: "POST", params: { status: "ACTIVE" } });
}

/**
 * Kampanya (CBO) gunluk butcesini gunceller. NOT: bu proje olusturdugu her
 * kampanyada butceyi ad-set seviyesinde ayarliyor (CBO kapali) - bu fonksiyon
 * o kampanyalarda etkisiz kalir. Gercek degisiklik icin meta/adsets.ts'deki
 * setAdSetBudget kullanilmali. Bu fonksiyon sadece CBO acik, disaridan/elle
 * olusturulmus kampanyalar icin anlamli.
 */
export async function setCampaignBudget(
  env: MetaEnv,
  campaignId: string,
  dailyBudgetTry: number,
): Promise<void> {
  await graphRequest(env, `/${campaignId}`, {
    method: "POST",
    params: { daily_budget: tryToCents(dailyBudgetTry) },
  });
}

export async function getCampaignStatus(env: MetaEnv, campaignId: string): Promise<Record<string, unknown>> {
  const fields = ["name", "status", "daily_budget", "objective"].join(",");
  return await graphRequest(env, `/${campaignId}`, { params: { fields } });
}

/** DIKKAT: Kalicidir, geri alinamaz. Tool katmani sadece PAUSED kampanyalar icin ve onayla izin verir. */
export async function deleteCampaign(env: MetaEnv, campaignId: string): Promise<void> {
  await graphRequest(env, `/${campaignId}`, { method: "DELETE" });
}
