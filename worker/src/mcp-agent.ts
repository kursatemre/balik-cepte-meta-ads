/**
 * Balik Cepte Meta Ads MCP sunucusu.
 *
 * cli.py'deki her komut icin bir tool - tek fark `campaign resume`: CLI'daki
 * interaktif "y/n" onayinin yerini, tek bir MCP cagrisinin stdin okuyamamasi
 * yuzunden, iki asamali bir akis aliyor:
 *   1) campaign_resume_preview  -> durumu gosterir + kisa omurlu confirm_token uretir
 *   2) campaign_resume_confirm -> sadece dogru token ile ACTIVE yapar
 * Boylece mobilden tek bir mesajla ("su kampanyayi aktif et") yanlislikla
 * gercek harcama baslamaz - Claude once preview'i gormek zorunda.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import * as audiences from "./meta/audiences";
import * as campaigns from "./meta/campaigns";
import * as reports from "./meta/reports";
import * as store from "./store";
import { MetaApiError } from "./meta/client";

type Props = { userId: string };

interface PendingResume {
  campaignId: string;
  token: string;
  expiresAt: number;
}

type State = { pendingResume: PendingResume | null };

const RESUME_TOKEN_TTL_MS = 5 * 60 * 1000;

function errorResult(err: unknown) {
  const text = err instanceof MetaApiError ? err.format() : err instanceof Error ? err.message : String(err);
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
      .describe("creative_store_upload / creative_store_upload_from_url ile depoya kaydedilmis bir gorselin anahtari."),
  }),
]);

export class BalikCepteMcp extends McpAgent<Env, State, Props> {
  server = new McpServer({ name: "Balik Cepte Meta Ads", version: "1.0.0" });

  initialState: State = { pendingResume: null };

  async init() {
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
          countries: z.array(z.string()).optional().describe("Varsayilan: [\"TR\"]"),
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
          const token = crypto.randomUUID();
          const expiresAt = Date.now() + RESUME_TOKEN_TTL_MS;
          this.setState({ pendingResume: { campaignId: campaign_id, token, expiresAt } });
          return jsonResult({
            campaign: status,
            warning:
              "Bu kampanyayi ACTIVE yapmak GERCEK HARCAMAYI baslatir. Kullanicidan acik onay almadan " +
              "campaign_resume_confirm'i cagirma.",
            confirm_token: token,
            expires_in_seconds: RESUME_TOKEN_TTL_MS / 1000,
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
        const pending = this.state.pendingResume;
        if (!pending || pending.campaignId !== campaign_id || pending.token !== confirm_token) {
          return errorResult(
            new Error(
              "Gecersiz ya da eslesmeyen confirm_token. Once campaign_resume_preview'i bu campaign_id ile cagir.",
            ),
          );
        }
        if (Date.now() > pending.expiresAt) {
          this.setState({ pendingResume: null });
          return errorResult(new Error("confirm_token'in suresi doldu (5 dk). campaign_resume_preview'i tekrar cagir."));
        }

        try {
          await campaigns.resumeCampaign(this.env, campaign_id);
          this.setState({ pendingResume: null });
          return jsonResult({ campaign_id, status: "ACTIVE" });
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "campaign_set_budget",
      {
        description:
          "Kampanya (CBO) gunluk butcesini gunceller. NOT: kampanya ACTIVE ise gercek harcama oranini " +
          "hemen degistirir. Ad-set seviyesinde butce kullanan kampanyalarda etkisiz kalir.",
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

    this.server.registerTool(
      "report",
      {
        description:
          "Kampanya performans raporu (impressions/clicks/spend/ctr/cpc/actions). since+until verilmezse " +
          "date_preset (varsayilan last_30d) kullanilir. campaign_id verilmezse hesap genelinde raporlar.",
        inputSchema: {
          since: z.string().optional().describe("YYYY-MM-DD"),
          until: z.string().optional().describe("YYYY-MM-DD"),
          date_preset: z.string().optional().describe("orn. last_7d, last_30d"),
          breakdown: z.string().optional().describe("orn. age, gender, publisher_platform"),
          campaign_id: z.string().optional(),
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
          });
          return jsonResult(rows);
        } catch (err) {
          return errorResult(err);
        }
      },
    );
  }
}
