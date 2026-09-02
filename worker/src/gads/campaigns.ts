/**
 * Google Ads kampanya yonetimi.
 *
 * NOT (bkz. plan/README): Bu dosyanin mutate payload sekilleri Basic Access
 * onayi gelmeden canli test edilemedi - Google Ads REST API'sinin bilinen
 * deseninden yazildi (GAQL sorgu string'leri snake_case, JSON response/
 * request alanlari camelCase kullanir). Ilk gercek cagrida GadsApiError'in
 * donduregi mesaja gore duzeltilmesi gerekebilir (Meta/ASA'da oldugu gibi).
 *
 * Google'da butce ayri bir kaynak (CampaignBudget) - kampanya onun
 * resource_name'ine referans verir. "Delete" gercekte yok, status=REMOVED'a
 * cekiliyor (kalici, geri alinamaz - bu yuzden tool katmaninda "delete"
 * olarak sunuluyor).
 */
import { fromMicros, gadsMutate, gadsSearch, requireCustomerId, toMicros, type GadsEnv } from "./client";

export interface CreateGadsCampaignInput {
  name: string;
  dailyBudget: number; // birim para, micros'a burada cevrilir
}

export async function createPausedCampaign(env: GadsEnv, input: CreateGadsCampaignInput): Promise<Record<string, unknown>> {
  const customerId = requireCustomerId(env);

  const budgetResults = await gadsMutate(env, customerId, "campaignBudgets", [
    {
      create: {
        name: `${input.name} - budget`,
        amountMicros: toMicros(input.dailyBudget),
        deliveryMethod: "STANDARD",
        explicitlyShared: false,
      },
    },
  ]);
  const budgetResourceName = budgetResults[0]?.resourceName as string;
  if (!budgetResourceName) throw new Error("Butce olusturulamadi - beklenmeyen yanit.");

  const campaignResults = await gadsMutate(env, customerId, "campaigns", [
    {
      create: {
        name: input.name,
        status: "PAUSED",
        advertisingChannelType: "SEARCH",
        campaignBudget: budgetResourceName,
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: false,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
        manualCpc: {},
      },
    },
  ]);
  const campaignResourceName = campaignResults[0]?.resourceName as string;
  if (!campaignResourceName) throw new Error("Kampanya olusturulamadi - beklenmeyen yanit.");

  return { resource_name: campaignResourceName, budget_resource_name: budgetResourceName, status: "PAUSED" };
}

function campaignIdFromResourceName(resourceName: string): string {
  const parts = resourceName.split("/");
  return parts[parts.length - 1];
}

export async function listCampaigns(env: GadsEnv): Promise<Record<string, unknown>[]> {
  const customerId = requireCustomerId(env);
  const query =
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, " +
    "campaign_budget.amount_micros FROM campaign ORDER BY campaign.id";
  const rows = await gadsSearch(env, customerId, query);
  return rows.map((r: any) => ({
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    advertising_channel_type: r.campaign?.advertisingChannelType,
    daily_budget: r.campaignBudget?.amountMicros ? fromMicros(r.campaignBudget.amountMicros) : null,
  }));
}

export async function getCampaignStatus(env: GadsEnv, campaignId: string): Promise<Record<string, unknown>> {
  const customerId = requireCustomerId(env);
  const query =
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, " +
    `campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${Number(campaignId)}`;
  const rows = await gadsSearch(env, customerId, query);
  const r: any = rows[0];
  if (!r) throw new Error(`Kampanya bulunamadi: ${campaignId}`);
  return {
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    advertising_channel_type: r.campaign?.advertisingChannelType,
    daily_budget: r.campaignBudget?.amountMicros ? fromMicros(r.campaignBudget.amountMicros) : null,
    resource_name: r.campaign?.resourceName,
    budget_resource_name: r.campaignBudget?.resourceName,
  };
}

async function updateCampaignStatus(env: GadsEnv, campaignId: string, status: "PAUSED" | "ENABLED"): Promise<void> {
  const customerId = requireCustomerId(env);
  await gadsMutate(env, customerId, "campaigns", [
    {
      update: { resourceName: `customers/${customerId}/campaigns/${campaignId}`, status },
      updateMask: "status",
    },
  ]);
}

export async function pauseCampaign(env: GadsEnv, campaignId: string): Promise<void> {
  await updateCampaignStatus(env, campaignId, "PAUSED");
}

/** DIKKAT: Kampanyayi ENABLED yapar, harcama baslar. Tool katmani onay ister. */
export async function resumeCampaign(env: GadsEnv, campaignId: string): Promise<void> {
  await updateCampaignStatus(env, campaignId, "ENABLED");
}

export async function setCampaignBudget(env: GadsEnv, campaignId: string, dailyBudget: number): Promise<void> {
  const customerId = requireCustomerId(env);
  const status = await getCampaignStatus(env, campaignId);
  const budgetResourceName = status.budget_resource_name as string;
  if (!budgetResourceName) throw new Error("Kampanyanin butce kaynagi bulunamadi.");
  await gadsMutate(env, customerId, "campaignBudgets", [
    {
      update: { resourceName: budgetResourceName, amountMicros: toMicros(dailyBudget) },
      updateMask: "amount_micros",
    },
  ]);
}

/** DIKKAT: Kalicidir (status=REMOVED), geri alinamaz. Tool katmani sadece PAUSED icin ve onayla izin verir. */
export async function deleteCampaign(env: GadsEnv, campaignId: string): Promise<void> {
  const customerId = requireCustomerId(env);
  await gadsMutate(env, customerId, "campaigns", [{ remove: `customers/${customerId}/campaigns/${campaignId}` }]);
}

export { campaignIdFromResourceName };
