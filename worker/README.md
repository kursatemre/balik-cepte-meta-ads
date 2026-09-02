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

## Araçlar (tools)

`audience_status`, `campaign_status`, `campaign_create`, `campaign_pause`,
`campaign_resume_preview`, `campaign_resume_confirm`, `campaign_set_budget`,
`report` — her biri `cli.py`'deki komutlarla birebir eşleşiyor, detaylar için
tool açıklamalarına (Claude içinde görünür) ya da `src/mcp-agent.ts`'e bak.

**Görsel deposu (R2)**: `creative_store_list`, `creative_store_upload`
(base64), `creative_store_upload_from_url`, `creative_store_delete`. Bir
görseli bir kere depoya kaydet, sonra `campaign_create`'de `images` alanında
`{"key": "kart1.jpg"}` ile tekrar tekrar referans ver — her seferinde yeniden
yüklemeye gerek kalmaz. Python CLI'daki yerel `creatives/` klasörünün uzaktan
erişilebilir karşılığı.

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
