/**
 * Balik Cepte Meta Ads MCP sunucusu.
 *
 * cli.py'deki her komut icin bir tool, artik ad-set ve reklam seviyesinde
 * de kontrol var. Harcama baslatan/kalici olan islemler (resume, delete)
 * icin CLI'daki interaktif "y/n" onayinin yerini, tek bir MCP cagrisinin
 * stdin okuyamamasi yuzunden, iki asamali bir akis aliyor:
 *   1) *_preview  -> durumu gosterir + kisa omurlu confirm_token uretir
 *   2) *_confirm -> sadece dogru token ile gercek islemi yapar
 * Tek bir "pending" slotu var (this.state.pending) - yeni bir preview,
 * bir onceki bekleyen islemi gecersiz kilar. Boylece mobilden tek bir
 * mesajla yanlislikla harcama baslamaz / kampanya silinmez.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import * as ads from "./meta/ads";
import * as adsets from "./meta/adsets";
import * as audiences from "./meta/audiences";
import * as campaigns from "./meta/campaigns";
import * as reports from "./meta/reports";
import * as store from "./store";
import { MetaApiError } from "./meta/client";

import * as asaAccount from "./asa/account";
import * as asaAdgroups from "./asa/adgroups";
import * as asaCampaigns from "./asa/campaigns";
import * as asaKeywords from "./asa/keywords";
import * as asaReports from "./asa/reports";
import { AsaApiError } from "./asa/client";

type Props = { userId: string };

type PendingKind =
  | "campaign_resume"
  | "adset_resume"
  | "ad_resume"
  | "campaign_delete"
  | "asa_campaign_resume"
  | "asa_adgroup_resume"
  | "asa_campaign_delete";

interface PendingAction {
  kind: PendingKind;
  targetId: string;
  token: string;
  expiresAt: number;
}

type State = { pending: PendingAction | null };

const CONFIRM_TOKEN_TTL_MS = 5 * 60 * 1000;

function errorResult(err: unknown) {
  const text =
    err instanceof MetaApiError || err instanceof AsaApiError
      ? err.format()
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

function jsonResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

const imageInputSchema = z.union([
  z.object({ url: z.string().url().describe("Herkese acik bir goruntu URL'i - sunucu indirip Meta'ya yukler.") }),
  z.object({ base64: z.string().describe("Ham gorsel byte'larinin base64 kodu.") }),
  z.object({
    key: z
      .string()
      .describe(
        "creative_store_upload / creative_store_upload_from_url / mobil /upload sayfasi ile depoya kaydedilmis bir gorselin anahtari.",
      ),
  }),
]);

const statusFilterSchema = z
  .array(z.string())
  .optional()
  .describe('effective_status filtresi, orn. ["ACTIVE"], ["PAUSED"]. Verilmezse hepsi.');

export class BalikCepteMcp extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "Balik Cepte Meta Ads", version: "1.0.0" });

  initialState: State = { pending: null };

  /** Bir preview tool'unun sonunda cagrilir - eski pending'i ezer, yeni token doner. */
  private armPending(kind: PendingKind, targetId: string): { token: string; expiresInSeconds: number } {
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + CONFIRM_TOKEN_TTL_MS;
    this.setState({ pending: { kind, targetId, token, expiresAt } });
    return { token, expiresInSeconds: CONFIRM_TOKEN_TTL_MS / 1000 };
  }

  /** Bir confirm tool'unun basinda cagrilir - gecerliyse pending'i tuketir (null'lar), hata metni ya da null doner. */
  private consumePending(kind: PendingKind, targetId: string, token: string): string | null {
    const pending = this.state.pending;
    if (!pending || pending.kind !== kind || pending.targetId !== targetId || pending.token !== token) {
      return "Gecersiz ya da eslesmeyen confirm_token. Once ilgili preview tool'unu bu id ile cagir.";
    }
    if (Date.now() > pending.expiresAt) {
      this.setState({ pending: null });
      return "confirm_token'in suresi doldu (5 dk). Preview tool'unu tekrar cagir.";
    }
    this.setState({ pending: null });
    return null;
  }

  async init() {
    // ---- Audience ----------------------------------------------------

    this.server.registerTool(
      "audience_list",
      {
        description: "Hesaptaki Custom Audience'lari listeler (id, ad, yaklasik boyut, delivery_status).",
        inputSchema: {},
      },
      async () => {
        try {
          return jsonResult(await audiences.listAudiences(this.env));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "audience_status",
      {
        description:
          "Bir Meta Custom Audience'in kampanyada hedeflemek icin kullanima hazir olup olmadigini kontrol eder (boyut + delivery_status).",
        inputSchema: { audience_id: z.string() },
      },
      async ({ audience_id }) => {
        try {
          return jsonResult(await audiences.getAudienceStatus(this.env, audience_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- Campaign -------------------------------------------------------

    this.server.registerTool(
      "campaign_list",
      {
        description: "Hesaptaki kampanyalari listeler (id, ad, durum, objective, gunluk butce).",
        inputSchema: { status: statusFilterSchema },
      },
      async ({ status }) => {
        try {
          return jsonResult(await campaigns.listCampaigns(this.env, { status }));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_status",
      {
        description: "Bir kampanyanin guncel adini, durumunu (PAUSED/ACTIVE), gunluk butcesini ve objective'ini gosterir.",
        inputSchema: { campaign_id: z.string() },
      },
      async ({ campaign_id }) => {
        try {
          return jsonResult(await campaigns.getCampaignStatus(this.env, campaign_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_create",
      {
        description:
          "Yeni bir kampanya + ad set + reklam olusturur. GUVENLIK: kampanya HER ZAMAN PAUSED " +
          "olusturulur (harcama baslamaz) - bunu degistiren bir parametre yoktur, sunucu tarafinda " +
          "sabit. Aktif etmek icin ayrica campaign_resume_preview + campaign_resume_confirm gerekir. " +
          "dry_run=true ile hicbir API cagrisi yapmadan payload'i onizleyebilirsin.",
        inputSchema: {
          name: z.string(),
          objective: z.string().default(campaigns.DEFAULT_OBJECTIVE),
          optimization_goal: z.string().default(campaigns.DEFAULT_OPTIMIZATION_GOAL),
          custom_event_type: z
            .string()
            .optional()
            .describe(
              "Belirli bir uygulama-ici event'i hedeflemek icin (orn. SUBSCRIBE, PURCHASE). Verilirse " +
                "optimization_goal genelde OFFSITE_CONVERSIONS olmali - kitle zaten uygulamayi yuklemis " +
                "kisilerden olusuyorsa APP_INSTALLS anlamsiz kalir.",
            ),
          billing_event: z.string().default(campaigns.DEFAULT_BILLING_EVENT),
          daily_budget_try: z
            .number()
            .positive()
            .describe(
              "TRY cinsinden gunluk butce. Meta'nin minimumu hesaba gore degisir (bu proje icin ~48 TRY " +
                "civariydi) - dusukse acik bir 'Butce Cok Dusuk' hatasi doner.",
            ),
          audience_id: z.string(),
          countries: z.array(z.string()).optional().describe('Varsayilan: ["TR"]'),
          creative_type: z.enum(["single", "carousel"]),
          images: z.array(imageInputSchema).min(1).describe("carousel icin gorsel sayisi = headline sayisi olmali."),
          headlines: z.array(z.string()).min(1),
          descriptions: z.array(z.string()).optional(),
          message: z.string().optional(),
          link: z.string().url(),
          app_id: z.string().optional().describe("Verilmezse META_PROMOTED_APP_ID secret kullanilir."),
          app_store_url: z.string().optional().describe("Verilmezse META_APP_STORE_URL secret kullanilir."),
          page_id: z.string().optional().describe("Verilmezse META_PAGE_ID secret kullanilir."),
          dry_run: z.boolean().default(false).describe("true ise hicbir API cagrisi yapilmaz, sadece payload donulur."),
        },
      },
      async (args) => {
        try {
          const appId = args.app_id ?? this.env.META_PROMOTED_APP_ID;
          const appStoreUrl = args.app_store_url ?? this.env.META_APP_STORE_URL;
          const pageId = args.page_id ?? this.env.META_PAGE_ID;
          const missing = [
            !appId && "app_id / META_PROMOTED_APP_ID",
            !appStoreUrl && "app_store_url / META_APP_STORE_URL",
            !pageId && "page_id / META_PAGE_ID",
          ].filter(Boolean);
          if (missing.length) {
            throw new Error(`Eksik: ${missing.join(", ")}`);
          }

          const result = await campaigns.createPausedCampaign(this.env, {
            name: args.name,
            dailyBudgetTry: args.daily_budget_try,
            audienceId: args.audience_id,
            appId: appId!,
            appStoreUrl: appStoreUrl!,
            pageId: pageId!,
            link: args.link,
            creativeType: args.creative_type,
            images: args.images,
            headlines: args.headlines,
            descriptions: args.descriptions,
            message: args.message,
            objective: args.objective,
            optimizationGoal: args.optimization_goal,
            billingEvent: args.billing_event,
            countries: args.countries,
            customEventType: args.custom_event_type,
            dryRun: args.dry_run,
          });
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_pause",
      {
        description: "Kampanyayi PAUSED yapar (harcamayi keser). Onay gerektirmez - geri alinmasi kolay/guvenli bir islem.",
        inputSchema: { campaign_id: z.string() },
      },
      async ({ campaign_id }) => {
        try {
          await campaigns.pauseCampaign(this.env, campaign_id);
          return jsonResult({ campaign_id, status: "PAUSED" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_resume_preview",
      {
        description:
          "Kampanyayi ACTIVE yapmadan ONCE guncel durumunu (ad, butce, objective) gosterir ve 5 dakika " +
          "gecerli bir confirm_token uretir. Gercekten aktif etmek icin bu token'i campaign_resume_confirm'e " +
          "ver - bu iki adimli akis, tek bir mesajla yanlislikla harcama baslatilmasini onlemek icin var.",
        inputSchema: { campaign_id: z.string() },
      },
      async ({ campaign_id }) => {
        try {
          const status = await campaigns.getCampaignStatus(this.env, campaign_id);
          const { token, expiresInSeconds } = this.armPending("campaign_resume", campaign_id);
          return jsonResult({
            campaign: status,
            warning:
              "Bu kampanyayi ACTIVE yapmak GERCEK HARCAMAYI baslatir. Kullanicidan acik onay almadan " +
              "campaign_resume_confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_resume_confirm",
      {
        description:
          "campaign_resume_preview'den alinan confirm_token ile kampanyayi GERCEKTEN ACTIVE yapar. " +
          "Harcama BURADA baslar. Token yanlissa/suresi gecmisse reddedilir.",
        inputSchema: { campaign_id: z.string(), confirm_token: z.string() },
      },
      async ({ campaign_id, confirm_token }) => {
        const err = this.consumePending("campaign_resume", campaign_id, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await campaigns.resumeCampaign(this.env, campaign_id);
          return jsonResult({ campaign_id, status: "ACTIVE" });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    this.server.registerTool(
      "campaign_set_budget",
      {
        description:
          "Kampanya (CBO) gunluk butcesini gunceller. NOT: bu proje olusturdugu kampanyalarda butceyi " +
          "HER ZAMAN ad-set seviyesinde ayarlar (CBO kapali) - o kampanyalarda bu tool'un etkisi olmaz, " +
          "onun yerine adset_set_budget kullan. Bu sadece CBO acik (kampanya butceli) kampanyalar icindir.",
        inputSchema: { campaign_id: z.string(), daily_budget_try: z.number().positive() },
      },
      async ({ campaign_id, daily_budget_try }) => {
        try {
          await campaigns.setCampaignBudget(this.env, campaign_id, daily_budget_try);
          return jsonResult({ campaign_id, daily_budget_try });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_delete_preview",
      {
        description:
          "Bir kampanyayi silmeden ONCE durumunu gosterir ve 5 dakika gecerli bir confirm_token uretir. " +
          "GUVENLIK: kampanya PAUSED degilse reddedilir (once campaign_pause cagir). Silme KALICIDIR, " +
          "geri alinamaz.",
        inputSchema: { campaign_id: z.string() },
      },
      async ({ campaign_id }) => {
        try {
          const status = await campaigns.getCampaignStatus(this.env, campaign_id);
          if (status.status !== "PAUSED") {
            throw new Error(
              `Kampanya '${status.name}' su an ${status.status} - silmeden once campaign_pause ile durdur.`,
            );
          }
          const { token, expiresInSeconds } = this.armPending("campaign_delete", campaign_id);
          return jsonResult({
            campaign: status,
            warning: "Bu kampanyayi silmek KALICIDIR ve geri alinamaz. Onaylamadan campaign_delete_confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_delete_confirm",
      {
        description:
          "campaign_delete_preview'den alinan confirm_token ile kampanyayi KALICI olarak siler. Geri alinamaz.",
        inputSchema: { campaign_id: z.string(), confirm_token: z.string() },
      },
      async ({ campaign_id, confirm_token }) => {
        const err = this.consumePending("campaign_delete", campaign_id, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await campaigns.deleteCampaign(this.env, campaign_id);
          return jsonResult({ campaign_id, deleted: true });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // ---- Ad Set -----------------------------------------------------

    this.server.registerTool(
      "adset_list",
      {
        description:
          "Ad set'leri listeler - campaign_id verilirse o kampanyanin ad set'leri, verilmezse hesap geneli.",
        inputSchema: { campaign_id: z.string().optional(), status: statusFilterSchema },
      },
      async ({ campaign_id, status }) => {
        try {
          return jsonResult(await adsets.listAdSets(this.env, { campaignId: campaign_id, status }));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "adset_status",
      {
        description: "Bir ad set'in adini, durumunu, gunluk butcesini, optimization_goal'ini ve kampanya id'sini gosterir.",
        inputSchema: { adset_id: z.string() },
      },
      async ({ adset_id }) => {
        try {
          return jsonResult(await adsets.getAdSetStatus(this.env, adset_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "adset_pause",
      {
        description: "Tek bir ad set'i PAUSED yapar (tum kampanyayi degil). Onay gerektirmez.",
        inputSchema: { adset_id: z.string() },
      },
      async ({ adset_id }) => {
        try {
          await adsets.pauseAdSet(this.env, adset_id);
          return jsonResult({ adset_id, status: "PAUSED" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "adset_resume_preview",
      {
        description:
          "Ad set'i ACTIVE yapmadan once durumunu gosterir ve 5 dakika gecerli bir confirm_token uretir.",
        inputSchema: { adset_id: z.string() },
      },
      async ({ adset_id }) => {
        try {
          const status = await adsets.getAdSetStatus(this.env, adset_id);
          const { token, expiresInSeconds } = this.armPending("adset_resume", adset_id);
          return jsonResult({
            adset: status,
            warning: "Bu ad set'i ACTIVE yapmak GERCEK HARCAMAYI baslatir. Onaylamadan adset_resume_confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "adset_resume_confirm",
      {
        description: "adset_resume_preview'den alinan confirm_token ile ad set'i GERCEKTEN ACTIVE yapar.",
        inputSchema: { adset_id: z.string(), confirm_token: z.string() },
      },
      async ({ adset_id, confirm_token }) => {
        const err = this.consumePending("adset_resume", adset_id, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await adsets.resumeAdSet(this.env, adset_id);
          return jsonResult({ adset_id, status: "ACTIVE" });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    this.server.registerTool(
      "adset_set_budget",
      {
        description:
          "Ad set'in gunluk butcesini gunceller. Bu proje HER ZAMAN ad-set seviyesinde butce kullandigi " +
          "icin gercek butce degisikligi icin dogru tool bu (campaign_set_budget degil).",
        inputSchema: { adset_id: z.string(), daily_budget_try: z.number().positive() },
      },
      async ({ adset_id, daily_budget_try }) => {
        try {
          await adsets.setAdSetBudget(this.env, adset_id, daily_budget_try);
          return jsonResult({ adset_id, daily_budget_try });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- Ad -----------------------------------------------------------

    this.server.registerTool(
      "ad_list",
      {
        description:
          "Reklamlari listeler - adset_id ya da campaign_id verilirse o kapsamda, hicbiri verilmezse hesap geneli.",
        inputSchema: { adset_id: z.string().optional(), campaign_id: z.string().optional(), status: statusFilterSchema },
      },
      async ({ adset_id, campaign_id, status }) => {
        try {
          return jsonResult(await ads.listAds(this.env, { adsetId: adset_id, campaignId: campaign_id, status }));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "ad_status",
      {
        description: "Bir reklamin adini, durumunu, ad set/kampanya id'sini gosterir.",
        inputSchema: { ad_id: z.string() },
      },
      async ({ ad_id }) => {
        try {
          return jsonResult(await ads.getAdStatus(this.env, ad_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "ad_pause",
      {
        description: "Tek bir reklami PAUSED yapar. Onay gerektirmez.",
        inputSchema: { ad_id: z.string() },
      },
      async ({ ad_id }) => {
        try {
          await ads.pauseAd(this.env, ad_id);
          return jsonResult({ ad_id, status: "PAUSED" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "ad_resume_preview",
      {
        description: "Reklami ACTIVE yapmadan once durumunu gosterir ve 5 dakika gecerli bir confirm_token uretir.",
        inputSchema: { ad_id: z.string() },
      },
      async ({ ad_id }) => {
        try {
          const status = await ads.getAdStatus(this.env, ad_id);
          const { token, expiresInSeconds } = this.armPending("ad_resume", ad_id);
          return jsonResult({
            ad: status,
            warning: "Bu reklami ACTIVE yapmak GERCEK HARCAMAYI baslatir. Onaylamadan ad_resume_confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "ad_resume_confirm",
      {
        description: "ad_resume_preview'den alinan confirm_token ile reklami GERCEKTEN ACTIVE yapar.",
        inputSchema: { ad_id: z.string(), confirm_token: z.string() },
      },
      async ({ ad_id, confirm_token }) => {
        const err = this.consumePending("ad_resume", ad_id, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await ads.resumeAd(this.env, ad_id);
          return jsonResult({ ad_id, status: "ACTIVE" });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    this.server.registerTool(
      "ad_preview",
      {
        description:
          "Mevcut bir reklamin gercekte nasil gorunecegini (HTML) getirir - ACTIVE etmeden once gorsel " +
          "QA icin kullan. ad_format ornekleri: MOBILE_FEED_STANDARD (varsayilan), DESKTOP_FEED_STANDARD, " +
          "INSTAGRAM_STANDARD, INSTAGRAM_STORY.",
        inputSchema: { ad_id: z.string(), ad_format: z.string().optional() },
      },
      async ({ ad_id, ad_format }) => {
        try {
          return jsonResult(await ads.previewAd(this.env, ad_id, ad_format));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- Gorsel deposu (R2) --------------------------------------------

    this.server.registerTool(
      "creative_store_list",
      {
        description:
          "Kalici gorsel deposunda (R2) saklanan gorsellerin listesini gosterir - anahtar, boyut, yuklenme " +
          "tarihi. campaign_create'de images alaninda {key: ...} ile referans vermeden once buradan bak.",
        inputSchema: {},
      },
      async () => {
        try {
          return jsonResult(await store.listCreatives(this.env.CREATIVES));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "creative_store_upload",
      {
        description:
          "Bir gorseli (base64 verilerek) kalici depoya (R2) kaydeder - sonra campaign_create'de " +
          "images alaninda {key: ...} ile tekrar tekrar referans verilebilir, her seferinde yeniden " +
          "yuklemeye gerek kalmaz.",
        inputSchema: {
          key: z.string().describe("Dosya adi/anahtar, orn. kart1.jpg. Ayni anahtar tekrar kullanilirsa uzerine yazar."),
          base64: z.string().describe("Ham gorsel byte'larinin base64 kodu."),
          content_type: z.string().optional().describe("orn. image/jpeg, image/png"),
        },
      },
      async ({ key, base64, content_type }) => {
        try {
          await store.uploadCreativeFromBase64(this.env.CREATIVES, key, base64, content_type);
          return jsonResult({ key, stored: true });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "creative_store_upload_from_url",
      {
        description: "Bir goruntu URL'ini indirip kalici depoya (R2) kaydeder - creative_store_upload'in URL versiyonu.",
        inputSchema: {
          key: z.string().describe("Dosya adi/anahtar, orn. kart1.jpg."),
          url: z.string().url(),
        },
      },
      async ({ key, url }) => {
        try {
          await store.uploadCreativeFromUrl(this.env.CREATIVES, key, url);
          return jsonResult({ key, stored: true });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "creative_store_delete",
      {
        description: "Depodan bir gorseli siler.",
        inputSchema: { key: z.string() },
      },
      async ({ key }) => {
        try {
          await store.deleteCreative(this.env.CREATIVES, key);
          return jsonResult({ key, deleted: true });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- Rapor ----------------------------------------------------------

    this.server.registerTool(
      "report",
      {
        description:
          "Performans raporu (impressions/clicks/spend/ctr/cpc/actions). since+until verilmezse " +
          "date_preset (varsayilan last_30d) kullanilir. campaign_id verilmezse hesap genelinde raporlar. " +
          "level ile kirilim seviyesi secilir: campaign (varsayilan), adset, ad.",
        inputSchema: {
          since: z.string().optional().describe("YYYY-MM-DD"),
          until: z.string().optional().describe("YYYY-MM-DD"),
          date_preset: z.string().optional().describe("orn. last_7d, last_30d"),
          breakdown: z.string().optional().describe("orn. age, gender, publisher_platform"),
          campaign_id: z.string().optional(),
          level: z.enum(["campaign", "adset", "ad"]).default("campaign"),
        },
      },
      async (args) => {
        try {
          const rows = await reports.getInsights(this.env, {
            since: args.since,
            until: args.until,
            datePreset: args.date_preset,
            breakdown: args.breakdown,
            campaignId: args.campaign_id,
            level: args.level,
          });
          return jsonResult(rows);
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // =====================================================================
    // Apple Search Ads (ASA)
    // =====================================================================

    this.server.registerTool(
      "asa_org_info",
      {
        description: "Apple Search Ads hesap/org bilgisini gosterir (orgId, currency, roller) - debug/dogrulama icin.",
        inputSchema: {},
      },
      async () => {
        try {
          return jsonResult(await asaAccount.getAcls(this.env));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- ASA Kampanya ---------------------------------------------------

    this.server.registerTool(
      "asa_campaign_list",
      { description: "Apple Search Ads kampanyalarini listeler.", inputSchema: {} },
      async () => {
        try {
          return jsonResult(await asaCampaigns.listCampaigns(this.env));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_status",
      { description: "Bir ASA kampanyasinin durumunu gosterir.", inputSchema: { campaign_id: z.string() } },
      async ({ campaign_id }) => {
        try {
          return jsonResult(await asaCampaigns.getCampaignStatus(this.env, campaign_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_create",
      {
        description:
          "Yeni bir Apple Search Ads kampanyasi olusturur. GUVENLIK: HER ZAMAN PAUSED olusturulur - " +
          "bunu degistiren bir parametre yoktur. Aktif etmek icin asa_campaign_resume_preview + " +
          "asa_campaign_resume_confirm gerekir.",
        inputSchema: {
          name: z.string(),
          daily_budget: z.number().positive().describe("Gunluk butce (org para birimi, varsayilan USD)."),
          currency: z.string().optional().describe("Varsayilan: USD (org currency'si)."),
          adam_id: z.string().optional().describe("Verilmezse ASA_ADAM_ID secret (Balik Cepte) kullanilir."),
          countries_or_regions: z.array(z.string()).optional().describe('Varsayilan: ["TR"]'),
        },
      },
      async (args) => {
        try {
          const adamId = args.adam_id ?? this.env.ASA_ADAM_ID;
          const result = await asaCampaigns.createPausedCampaign(this.env, {
            name: args.name,
            dailyBudgetAmount: args.daily_budget,
            currency: args.currency,
            adamId,
            countriesOrRegions: args.countries_or_regions,
          });
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_pause",
      { description: "ASA kampanyasini PAUSED yapar. Onay gerektirmez.", inputSchema: { campaign_id: z.string() } },
      async ({ campaign_id }) => {
        try {
          await asaCampaigns.pauseCampaign(this.env, campaign_id);
          return jsonResult({ campaign_id, status: "PAUSED" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_resume_preview",
      {
        description: "ASA kampanyasini ENABLED yapmadan once durumunu gosterir ve 5 dk gecerli confirm_token uretir.",
        inputSchema: { campaign_id: z.string() },
      },
      async ({ campaign_id }) => {
        try {
          const status = await asaCampaigns.getCampaignStatus(this.env, campaign_id);
          const { token, expiresInSeconds } = this.armPending("asa_campaign_resume", campaign_id);
          return jsonResult({
            campaign: status,
            warning: "Bu kampanyayi ENABLED yapmak GERCEK HARCAMAYI baslatir. Onaylamadan confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_resume_confirm",
      {
        description: "asa_campaign_resume_preview'den alinan confirm_token ile kampanyayi GERCEKTEN ENABLED yapar.",
        inputSchema: { campaign_id: z.string(), confirm_token: z.string() },
      },
      async ({ campaign_id, confirm_token }) => {
        const err = this.consumePending("asa_campaign_resume", campaign_id, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await asaCampaigns.resumeCampaign(this.env, campaign_id);
          return jsonResult({ campaign_id, status: "ENABLED" });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_set_budget",
      {
        description: "ASA kampanyasinin gunluk butcesini gunceller.",
        inputSchema: { campaign_id: z.string(), daily_budget: z.number().positive(), currency: z.string().optional() },
      },
      async ({ campaign_id, daily_budget, currency }) => {
        try {
          await asaCampaigns.setCampaignBudget(this.env, campaign_id, daily_budget, currency);
          return jsonResult({ campaign_id, daily_budget });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_delete_preview",
      {
        description:
          "ASA kampanyasini silmeden once durumunu gosterir ve confirm_token uretir. PAUSED degilse reddedilir. " +
          "Silme KALICIDIR.",
        inputSchema: { campaign_id: z.string() },
      },
      async ({ campaign_id }) => {
        try {
          const status = await asaCampaigns.getCampaignStatus(this.env, campaign_id);
          if (status.status !== "PAUSED") {
            throw new Error(`Kampanya '${status.name}' su an ${status.status} - once asa_campaign_pause ile durdur.`);
          }
          const { token, expiresInSeconds } = this.armPending("asa_campaign_delete", campaign_id);
          return jsonResult({
            campaign: status,
            warning: "Bu kampanyayi silmek KALICIDIR ve geri alinamaz.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_campaign_delete_confirm",
      {
        description: "asa_campaign_delete_preview'den alinan confirm_token ile kampanyayi KALICI olarak siler.",
        inputSchema: { campaign_id: z.string(), confirm_token: z.string() },
      },
      async ({ campaign_id, confirm_token }) => {
        const err = this.consumePending("asa_campaign_delete", campaign_id, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await asaCampaigns.deleteCampaign(this.env, campaign_id);
          return jsonResult({ campaign_id, deleted: true });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // ---- ASA Ad Group -----------------------------------------------------

    this.server.registerTool(
      "asa_adgroup_list",
      { description: "Bir ASA kampanyasinin ad group'larini listeler.", inputSchema: { campaign_id: z.string() } },
      async ({ campaign_id }) => {
        try {
          return jsonResult(await asaAdgroups.listAdGroups(this.env, campaign_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_adgroup_status",
      {
        description: "Bir ASA ad group'un durumunu gosterir.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string() },
      },
      async ({ campaign_id, adgroup_id }) => {
        try {
          return jsonResult(await asaAdgroups.getAdGroupStatus(this.env, campaign_id, adgroup_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_adgroup_create",
      {
        description:
          "Bir ASA kampanyasi altinda yeni ad group olusturur. GUVENLIK: HER ZAMAN PAUSED olusturulur.",
        inputSchema: {
          campaign_id: z.string(),
          name: z.string(),
          default_bid: z.number().positive().describe("Varsayilan keyword teklifi."),
          currency: z.string().optional(),
          cpa_goal: z.number().optional().describe("Opsiyonel - CPA hedefi verilirse otomatik teklif kullanilir."),
        },
      },
      async (args) => {
        try {
          const result = await asaAdgroups.createPausedAdGroup(this.env, {
            campaignId: args.campaign_id,
            name: args.name,
            defaultBidAmount: args.default_bid,
            currency: args.currency,
            cpaGoal: args.cpa_goal,
          });
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_adgroup_pause",
      {
        description: "Ad group'u PAUSED yapar. Onay gerektirmez.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string() },
      },
      async ({ campaign_id, adgroup_id }) => {
        try {
          await asaAdgroups.pauseAdGroup(this.env, campaign_id, adgroup_id);
          return jsonResult({ adgroup_id, status: "PAUSED" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_adgroup_resume_preview",
      {
        description: "Ad group'u ENABLED yapmadan once durumunu gosterir ve 5 dk gecerli confirm_token uretir.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string() },
      },
      async ({ campaign_id, adgroup_id }) => {
        try {
          const status = await asaAdgroups.getAdGroupStatus(this.env, campaign_id, adgroup_id);
          const { token, expiresInSeconds } = this.armPending("asa_adgroup_resume", `${campaign_id}:${adgroup_id}`);
          return jsonResult({
            adgroup: status,
            warning: "Bu ad group'u ENABLED yapmak GERCEK HARCAMAYI baslatabilir. Onaylamadan confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: expiresInSeconds,
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_adgroup_resume_confirm",
      {
        description: "asa_adgroup_resume_preview'den alinan confirm_token ile ad group'u GERCEKTEN ENABLED yapar.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string(), confirm_token: z.string() },
      },
      async ({ campaign_id, adgroup_id, confirm_token }) => {
        const err = this.consumePending("asa_adgroup_resume", `${campaign_id}:${adgroup_id}`, confirm_token);
        if (err) return errorResult(new Error(err));
        try {
          await asaAdgroups.resumeAdGroup(this.env, campaign_id, adgroup_id);
          return jsonResult({ adgroup_id, status: "ENABLED" });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    this.server.registerTool(
      "asa_adgroup_set_bid",
      {
        description: "Ad group'un varsayilan keyword teklifini gunceller.",
        inputSchema: {
          campaign_id: z.string(),
          adgroup_id: z.string(),
          default_bid: z.number().positive(),
          currency: z.string().optional(),
        },
      },
      async ({ campaign_id, adgroup_id, default_bid, currency }) => {
        try {
          await asaAdgroups.setAdGroupBid(this.env, campaign_id, adgroup_id, default_bid, currency);
          return jsonResult({ adgroup_id, default_bid });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- ASA Keyword ------------------------------------------------------

    this.server.registerTool(
      "asa_keyword_list",
      {
        description: "Bir ad group'un targeting keyword'lerini listeler.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string() },
      },
      async ({ campaign_id, adgroup_id }) => {
        try {
          return jsonResult(await asaKeywords.listKeywords(this.env, campaign_id, adgroup_id));
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_keyword_create",
      {
        description:
          "Bir ad group'a targeting keyword(ler) ekler. Bunlar dogrudan ACTIVE olur (Meta'nin PAUSED-olustur " +
          "kuralinin aksine) - ama ad group zaten PAUSED ise harcama baslamaz, o yuzden dusuk risk kabul edildi. " +
          "Emin degilsen once asa_adgroup_status ile ad group'un PAUSED oldugunu dogrula.",
        inputSchema: {
          campaign_id: z.string(),
          adgroup_id: z.string(),
          keywords: z
            .array(
              z.object({
                text: z.string(),
                match_type: z.enum(["EXACT", "BROAD"]),
                bid_amount: z.number().positive().optional(),
                currency: z.string().optional(),
              }),
            )
            .min(1),
        },
      },
      async ({ campaign_id, adgroup_id, keywords }) => {
        try {
          const result = await asaKeywords.createKeywords(
            this.env,
            campaign_id,
            adgroup_id,
            keywords.map((k) => ({ text: k.text, matchType: k.match_type, bidAmount: k.bid_amount, currency: k.currency })),
          );
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_keyword_pause",
      {
        description: "Bir targeting keyword'u PAUSED yapar.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string(), keyword_id: z.string() },
      },
      async ({ campaign_id, adgroup_id, keyword_id }) => {
        try {
          await asaKeywords.pauseKeyword(this.env, campaign_id, adgroup_id, keyword_id);
          return jsonResult({ keyword_id, status: "PAUSED" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "asa_keyword_delete",
      {
        description: "Bir targeting keyword'u siler.",
        inputSchema: { campaign_id: z.string(), adgroup_id: z.string(), keyword_id: z.string() },
      },
      async ({ campaign_id, adgroup_id, keyword_id }) => {
        try {
          await asaKeywords.deleteKeyword(this.env, campaign_id, adgroup_id, keyword_id);
          return jsonResult({ keyword_id, deleted: true });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---- ASA Rapor ----------------------------------------------------------

    this.server.registerTool(
      "asa_report",
      {
        description: "Apple Search Ads performans raporu. level: campaign (varsayilan), adgroup, keyword.",
        inputSchema: {
          since: z.string().describe("YYYY-MM-DD"),
          until: z.string().describe("YYYY-MM-DD"),
          level: z.enum(["campaign", "adgroup", "keyword"]).default("campaign"),
          campaign_id: z.string().optional().describe("adgroup/keyword seviyesi icin gerekli."),
          adgroup_id: z.string().optional().describe("keyword seviyesi icin gerekli."),
        },
      },
      async (args) => {
        try {
          const result = await asaReports.getReport(this.env, {
            level: args.level,
            since: args.since,
            until: args.until,
            campaignId: args.campaign_id,
            adGroupId: args.adgroup_id,
          });
          return jsonResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  }
}
