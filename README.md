# Balık Cepte — Meta Ads Aracı

Meta Marketing API'ye doğrudan bağlanan, `act_244832992826003` (Balık Cepte) hesabını
yöneten bir Python CLI. AdWhispr'a ($39/ay yeni kampanya oluşturma ücreti) bağımlılığı
ortadan kaldırmak için yazıldı.

Sunucu yok — sadece ihtiyaç olduğunda terminalden çalıştırılan bir script. Ücretsiz,
bilgisayarı arka planda yormaz.

**Mobilden / PC'siz erişim gerekiyorsa**: [`worker/`](worker/) klasöründe aynı mantığın
Cloudflare Workers üzerinde çalışan bir MCP sunucusu portu var — Claude'a uzaktan
connector olarak bağlanabiliyor. Detay için [worker/README.md](worker/README.md).

## Kurulum

```bash
cd balik-cepte-meta-ads
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements-dev.txt
copy .env.example .env          # sonra .env'i doldur
```

`.env` içine gerekenler (`.env.example`'da açıklamalı):

- `META_APP_ID` / `META_APP_SECRET` — Meta for Developers > App Settings > Basic
- `META_ACCESS_TOKEN` — Business Settings > System Users'ta `act_244832992826003`'e
  scoped, `ads_management` + `ads_read` izinli, **System User** token'ı (kişisel
  login token'ı değil)
- `META_AD_ACCOUNT_ID` — varsayılan `act_244832992826003`
- `META_PAGE_ID` — varsayılan `190068084900577`
- `META_PROMOTED_APP_ID` — Events Manager > Data Sources'ta görünen, App
  Events'in aktığı Facebook App ID (API auth için kullanılan `META_APP_ID` ile
  aynı olabilir, teyit et)
- `META_APP_STORE_URL` — varsayılan `https://apps.apple.com/tr/app/id6765955082`

Zaten Instagram entegrasyonunu yaptığın için token oluşturma/App Review sürecini
biliyorsundur — burada tekrar anlatılmıyor.

## Güvenlik kuralı

**Her yeni kampanya/adset/reklam her zaman `PAUSED` oluşturulur.** `campaign create`
komutu asla otomatik `ACTIVE` yapmaz. `ACTIVE`'e geçiş sadece `campaign resume`
komutuyla, elle onay isteyerek yapılır.

## Önerilen akış

```bash
# 1) Hedeflenecek kitle kampanyada kullanıma hazır mı?
python cli.py audience status --audience-id 120246948804510513

# 2) Payload'ı gözden geçir (hiçbir API çağrısı yapılmaz)
python cli.py campaign create \
  --name "claude-carousel-test" \
  --objective OUTCOME_APP_PROMOTION \
  --daily-budget 40 \
  --audience-id 120246948804510513 \
  --creative-type carousel \
  --images kart1.jpg kart2.jpg kart3.jpg \
  --headlines "Bugünün En İyi Av Saatini Kaçırma" "Detaylı Tahminle Farkı Hisset" "Bir Kötü Av Günü, Yıllık Pro'dan Daha Pahalı Olabilir" \
  --link "https://apps.apple.com/tr/app/id6765955082" \
  --dry-run

# 3) Sorun yoksa --dry-run olmadan gerçekten oluştur (yine PAUSED)
python cli.py campaign create ... (yukarıdakiyle aynı, --dry-run olmadan)

# 4) Meta Ads Manager'da elle kontrol et (görsel, metin, hedefleme doğru mu?)

# 5) Onayladıysan aktif et (harcama BURADA başlar, onay ister)
python cli.py campaign resume --campaign-id <id>
```

## Diğer komutlar

```bash
# Mevcut kampanya yönetimi
python cli.py campaign status --campaign-id 120249296737950513
python cli.py campaign set-budget --campaign-id 120249296737950513 --daily-budget 600
python cli.py campaign pause --campaign-id 120249296737950513

# Raporlama
python cli.py report --since 2026-08-01 --until 2026-08-31 --export rapor.csv
python cli.py report --date-preset last_7d --breakdown publisher_platform
```

## Görseller nereden geliyor?

`--images` yerel dosya yolu bekler. Dış bir servise (AdWhispr dahil) bağımlı
değiliz — görselleri doğrudan [`creatives/`](creatives/) klasörüne koy, sonra
`--images creatives/dosya.jpg ...` ile yolunu ver. Detay için
[`creatives/README.md`](creatives/README.md).

## Test

```bash
pytest
```

Testler `unittest.mock` ile Meta SDK çağrılarını taklit eder — gerçek API'ye
dokunmaz, gerçek `.env` gerekmez. En kritik test: oluşturulan her kampanya/adset
payload'ının her zaman `PAUSED` içermesi.

## Bilinmesi gerekenler / sınırlar

- **Facebook App'in "Live" olması sart.** `META_APP_ID` gelistirme modundaysa
  (developers.facebook.com > uygulama > Yayin/Publish) reklam kreatifi
  olusturulurken "gelistirme modundaki bir uygulama" hatasi alinir - PAUSED
  olarak da olusturulsa fark etmez, bu kontrol reklamin durumundan bagimsiz.
- **Minimum ad-set gunluk butcesi degisken.** Bu yazi itibariyle (2026-09)
  `act_244832992826003` icin ~₺48,23 - daha dusuk deger "Butce Cok Dusuk"
  hatasi verir. Test kampanyalari icin ₺50+ kullan, gercek minimum degisirse
  Meta'nin hata mesaji tam degeri soyler.
- Meta, `objective`/`optimization_goal` gibi enum değerlerini zaman zaman
  günceller. İlk gerçek kampanyadan önce `meta_ads/campaigns.py` içindeki
  varsayılanları (`DEFAULT_OBJECTIVE`, `DEFAULT_OPTIMIZATION_GOAL`,
  `DEFAULT_BILLING_EVENT`) Meta Ads Manager'daki güncel akışla karşılaştır.
- `campaign set-budget`, kampanya seviyesinde bütçe (CBO — `claude TOF` gibi)
  varsayar. Ad-set seviyesinde bütçe kullanan bir kampanya için bu komut
  etkisiz kalır; gerekirse `meta_ads/campaigns.py`'a bir ad-set bütçe
  fonksiyonu eklenebilir.
- Webhook/gerçek-zamanlı olay dinleme bu sürümde yok (ihtiyaç yoktu). İleride
  gerekirse ayrı bir iş olarak eklenir.
- `meta_ads/creatives.py:upload_image` Meta SDK'nın döndürdüğü yanıtın birkaç
  olası şeklini dener; hiçbiri tutmazsa ham yanıtı basıp açık bir hata verir —
  o durumda fonksiyonu gerçek yanıta göre güncelle.
