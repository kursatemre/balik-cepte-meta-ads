# Balık Cepte Meta Ads — MCP Sunucusu (Cloudflare Workers)

`../` içindeki Python CLI'ın **uzaktan erişilebilir** (mobil dahil) hali. Cloudflare
Workers üzerinde çalışan bir MCP (Model Context Protocol) sunucusu — Claude'a
"custom connector" olarak bağlanır, PC/terminale ihtiyaç kalmaz.

Python CLI'ın yerini almaz — o hâlâ ana/test edilmiş araç. Bu, aynı Meta Ads
mantığının (aynı payload düzeltmeleriyle: `is_adset_budget_sharing_enabled`,
`bid_strategy`, `targeting.user_os`, base64 görsel yükleme) mobil erişim için
bir portu.

## Canlı adres

```
https://balik-cepte-meta-ads-mcp.balikcepte.workers.dev/mcp
```

## Güvenlik modeli

- **`campaign_create` her zaman PAUSED oluşturur** — bunu değiştiren bir
  parametre yok, sunucu tarafında sabit. Python CLI'daki kuralın birebir aynısı.
- **`campaign_resume` iki adımlı**: önce `campaign_resume_preview` (durumu
  gösterir + 5 dakika geçerli bir `confirm_token` üretir), sonra doğru token'la
  `campaign_resume_confirm`. Tek bir mesajla ("şu kampanyayı aktif et")
  yanlışlıkla harcama başlamasını engeller.
- **MCP uç noktası OAuth arkasında** — tek kullanıcılı basit bir parola ekranı
  (`MCP_ADMIN_PASSWORD` secret'ı), harici bir identity provider (GitHub/Google)
  yok. Parolayı bilmeyen biri bağlanamaz.
- Tüm Meta API hataları `error_user_msg` ile birlikte döner (Python
  `client.py`'deki iyileştirmenin portu) — sessiz/anlaşılmaz hata yok.

## Yapı

```
src/
  index.ts          - giris noktasi: OAuthProvider + /mcp route
  auth-handler.ts    - tek kullanicili parola ekrani (/authorize)
  mcp-agent.ts        - MCP tool tanimlari (cli.py komutlariyla birebir)
  meta/
    client.ts        - Graph API fetch sarmalayicisi + hata tipi
    audiences.ts      - kitle durum kontrolu
    campaigns.ts       - kampanya/adset/reklam olusturma+yonetim
    creatives.ts        - gorsel yukleme + creative payload'lari
    reports.ts           - performans raporu
```

## Kurulum (sıfırdan deploy)

```bash
cd worker
npm install

# KV namespace olustur (workers-oauth-provider bunu kullanir), donen id'yi
# wrangler.jsonc'deki OAUTH_KV binding'ine yaz.
npx wrangler kv namespace create OAUTH_KV

# Secrets (root ../.env ile ayni degerler, artı bir giris parolasi):
npx wrangler secret put MCP_ADMIN_PASSWORD
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put META_AD_ACCOUNT_ID
npx wrangler secret put META_PAGE_ID
npx wrangler secret put META_PROMOTED_APP_ID
npx wrangler secret put META_APP_STORE_URL

npx wrangler deploy
```

Yerel test için `.dev.vars.example`'ı `.dev.vars` olarak kopyala, doldur,
`npm run dev` ile çalıştır.

## Claude'a bağlama

1. Claude (web/mobil/desktop) → **Settings → Connectors → Add custom connector**
2. URL: `https://balik-cepte-meta-ads-mcp.balikcepte.workers.dev/mcp`
3. Açılan tarayıcı ekranında parolayı gir (bkz. `MCP_ADMIN_PASSWORD` secret'ı —
   ilk deploy'da terminalde paylaşıldı, kaybettiysen `wrangler secret put
   MCP_ADMIN_PASSWORD` ile yenisini ayarla)
4. Onayla — bundan sonra token kalıcı, her seferinde tekrar giriş gerekmez.

## Araçlar (tools) — 28 tool

**Kitle**: `audience_list`, `audience_status`

**Kampanya**: `campaign_list`, `campaign_status`, `campaign_create`,
`campaign_pause`, `campaign_resume_preview`/`campaign_resume_confirm`,
`campaign_set_budget` (sadece CBO/kampanya-butceli kampanyalar icin —
bkz. asagida), `campaign_delete_preview`/`campaign_delete_confirm`

**Ad Set**: `adset_list`, `adset_status`, `adset_pause`,
`adset_resume_preview`/`adset_resume_confirm`, `adset_set_budget`

**Ad**: `ad_list`, `ad_status`, `ad_pause`,
`ad_resume_preview`/`ad_resume_confirm`, `ad_preview` (gorsel QA - reklamin
gercekte nasil gorunecegini HTML olarak getirir)

**Rapor**: `report` (level: campaign/adset/ad kirilimi destekler)

⚠️ **`campaign_set_budget` vs `adset_set_budget`**: bu proje olusturdugu her
kampanyada butceyi HER ZAMAN ad-set seviyesinde ayarliyor (CBO kapali) - bu
yuzden kendi kampanyalarimiz icin **`adset_set_budget`** kullanilmali,
`campaign_set_budget` etkisiz kalir (sadece disaridan/elle CBO ile
olusturulmus kampanyalar icin anlamli).

**Tehlikeli islemler (resume, delete) icin ortak guvenlik deseni**: her biri
iki adimli - once `*_preview` (durumu gosterir + 5 dk gecerli `confirm_token`
uretir), sonra dogru token'la `*_confirm`. Tek bir "pending" slotu var - yeni
bir preview, bir onceki bekleyen islemi gecersiz kilar.

Detaylar icin tool aciklamalarina (Claude icinde gorunur) ya da
`src/mcp-agent.ts`'e bak.

**Görsel deposu (R2)**: `creative_store_list`, `creative_store_upload`
(base64), `creative_store_upload_from_url`, `creative_store_delete`. Bir
görseli bir kere depoya kaydet, sonra `campaign_create`'de `images` alanında
`{"key": "kart1.jpg"}` ile tekrar tekrar referans ver — her seferinde yeniden
yüklemeye gerek kalmaz. Python CLI'daki yerel `creatives/` klasörünün uzaktan
erişilebilir karşılığı.

## Apple Search Ads (ASA)

Meta'nın yanında aynı sunucuda **Apple Search Ads** entegrasyonu da var — 22 tool (`asa_` önekiyle), toplam **50 tool**.

**Auth tamamen farklı**: Meta'nın uzun ömürlü access token'ının aksine, ASA
kendi imzaladığın bir JWT ("client secret", ES256, `crypto.subtle` ile) ile
her ~1 saatte bir yeni access token istiyor. Kurulum (bir kerelik):

1. `openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem`
2. `openssl ec -in private-key.pem -pubout -out public-key.pem`
3. Apple Ads UI → Account Settings → API (bu sekmeyi görmek için hesabında
   **API Account Manager** ya da **API Account Read Only** rolü olmalı — Admin
   yetmiyor; ayrı bir kullanıcı davet edip o role atamak Admin yetkisini
   riske atmamanın en güvenli yolu) → public key'i yapıştır, kaydet →
   `clientId`/`teamId`/`keyId` gelir
4. `orgId`'yi bulmak için: `openssl pkcs8 -topk8 -nocrypt -in private-key.pem -out private-key-pkcs8.pem`,
   sonra bu PKCS8 key ile JWT imzalayıp `GET /v5/acls` çağır (ya da worker deploy edildikten
   sonra `asa_org_info` tool'unu kullan)
5. Secrets: `wrangler secret put ASA_CLIENT_ID/ASA_TEAM_ID/ASA_KEY_ID/ASA_ORG_ID/ASA_ADAM_ID/ASA_PRIVATE_KEY`
   (`ASA_PRIVATE_KEY` = **PKCS8** PEM içeriği, SEC1 değil — Web Crypto `importKey("pkcs8", ...)` SEC1 kabul etmiyor)

**API versiyonu**: v4 deprecated (`INVALID_API_VERSION` hatası verir), **v5** kullanılmalı.

**Tool'lar**: `asa_org_info`; kampanya (`asa_campaign_list/status/create/pause/resume_preview+confirm/set_budget/delete_preview+confirm`);
ad group (`asa_adgroup_list/status/create/pause/resume_preview+confirm/set_bid`);
keyword (`asa_keyword_list/create/pause/delete` — resume/confirm akışı yok, ad
group zaten PAUSED/kontrollüyse düşük risk kabul edildi); `asa_report`
(level: campaign/adgroup/keyword — **not**: `selector.orderBy` zorunlu ve
`groupBy`'da olmayan bir alanı referans alamaz, bkz. `src/asa/reports.ts`).

Güvenlik deseni Meta ile birebir aynı: `asa_campaign_create`/`asa_adgroup_create`
her zaman PAUSED; resume işlemleri preview+confirm_token gerektirir (aynı
genelleştirilmiş `this.state.pending` mekanizması).

Gerçek hesaba karşı test edildi (2026-09-02): kampanya+ad group+keyword
oluşturma, rapor çekme, delete_preview/confirm — hepsi uçtan uca doğrulandı.

**Telefondan görsel yükleme**: `https://.../upload` — Basic Auth ile korumalı
(kullanıcı adı önemsiz, parola `MCP_ADMIN_PASSWORD`), mobil tarayıcıdan
galeriden doğrudan dosya seçip yükleyebileceğin bir sayfa. `creative_store_upload_from_url`
zaten barındırılmış bir URL gerektiriyordu ve Claude (model olarak) sohbette
gördüğü bir görselin ham byte'larını harfiyen base64 olarak yeniden üretemez
(vision girdisi tersine çevrilemez) — bu sayfa "görseli önce bir yere
barındırmam lazım" sorununu asıl çözen adım.

## Test edildi mi?

Evet — bu oturumda gerçek deploy'a karşı: OAuth (DCR + PKCE + password login +
token exchange), MCP `initialize`/`tools/list`, gerçek Meta API'ye
`audience_status` çağrısı, ve `campaign_resume_preview` → yanlış token'la
`campaign_resume_confirm` reddi uçtan uca doğrulandı.
