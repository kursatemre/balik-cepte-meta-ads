"""Kampanya / ad set / reklam olusturma ve mevcut kampanya yonetimi.

Guvenlik kurali: `create_paused_campaign` her zaman PAUSED durumda kampanya/
adset/reklam olusturur. ENABLED'a gecis sadece `resume()` ile, ayri ve acik
bir adimda yapilir - burada asla otomatik tetiklenmez.
"""
from __future__ import annotations

from typing import Any, Optional

from facebook_business.adobjects.ad import Ad
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.campaign import Campaign

from . import creatives
from .audiences import ensure_ready
from .client import call, ensure_api_initialized, get_ad_account

# NOT: Meta bu enum degerlerini zaman zaman gunceller/yeniden adlandirir.
# Ilk gercek kampanyadan once Meta Ads Manager > Kampanya olustur akisinda
# ayni objective/optimization_goal degerlerinin hala gecerli oldugunu teyit et.
DEFAULT_OBJECTIVE = "OUTCOME_APP_PROMOTION"
DEFAULT_OPTIMIZATION_GOAL = "APP_INSTALLS"
DEFAULT_BILLING_EVENT = "IMPRESSIONS"
DEFAULT_COUNTRIES = ["TR"]


def _try_to_cents(try_amount: float) -> int:
    """Turk Lirasi'ni Meta'nin bekledigi en kucuk birime (kurus) cevirir."""
    return int(round(try_amount * 100))


def build_campaign_payload(*, name: str, objective: str = DEFAULT_OBJECTIVE) -> dict[str, Any]:
    return {
        Campaign.Field.name: name,
        Campaign.Field.objective: objective,
        Campaign.Field.status: Campaign.Status.paused,
        "special_ad_categories": [],
        # Butcemiz her zaman ad-set seviyesinde (CBO kapali) - bu araç
        # kampanya seviyesinde butce kullanmiyor. Meta bu alani artik
        # zorunlu kiliyor (asagidaki False secimi olmadan create_campaign
        # "is_adset_budget_sharing_enabled alaninda True veya False
        # belirtilmelidir" hatasi veriyor).
        "is_adset_budget_sharing_enabled": False,
    }


def build_adset_payload(
    *,
    name: str,
    campaign_id: str,
    daily_budget_try: float,
    audience_id: Optional[str] = None,
    app_id: str,
    app_store_url: str,
    optimization_goal: str = DEFAULT_OPTIMIZATION_GOAL,
    billing_event: str = DEFAULT_BILLING_EVENT,
    countries: Optional[list[str]] = None,
    custom_event_type: Optional[str] = None,
) -> dict[str, Any]:
    promoted_object: dict[str, Any] = {
        "application_id": app_id,
        "object_store_url": app_store_url,
    }
    # custom_event_type verilirse (ornegin "SUBSCRIBE"), optimizasyon App
    # Installs yerine belirli bir uygulama-ici event'i hedefler. Kitle zaten
    # uygulamayi yuklemis kisilerden olusuyorsa (ornegin "acik ama abone
    # degil") bu sart - App Installs optimizasyonu bu kisiler icin anlamsiz.
    if custom_event_type:
        promoted_object["custom_event_type"] = custom_event_type

    targeting: dict[str, Any] = {
        "geo_locations": {"countries": countries or DEFAULT_COUNTRIES},
        # object_store_url her zaman Apple App Store'a isaret ediyor -
        # targeting bunu iOS'a kisitlamazsa Meta "Mobile Targeting
        # Mismatch" hatasi veriyor (uygulama tek platform, hedefleme
        # coklu platform varsayiyordu).
        "user_os": ["iOS"],
    }
    # audience_id verilmezse Meta'nin genis/Advantage+ hedeflemesine
    # birakilir (orn. mevcut "claude TOF" kampanyasi da custom_audiences
    # kullanmiyor).
    if audience_id:
        targeting["custom_audiences"] = [{"id": audience_id}]

    return {
        AdSet.Field.name: name,
        AdSet.Field.campaign_id: campaign_id,
        AdSet.Field.daily_budget: _try_to_cents(daily_budget_try),
        AdSet.Field.billing_event: billing_event,
        AdSet.Field.optimization_goal: optimization_goal,
        # Meta artik teklif stratejisinin acikca belirtilmesini istiyor.
        # LOWEST_COST_WITHOUT_CAP = teklif tutari/sinir gerektirmeyen, en
        # dusuk maliyeti hedefleyen varsayilan strateji.
        AdSet.Field.bid_strategy: AdSet.BidStrategy.lowest_cost_without_cap,
        AdSet.Field.status: AdSet.Status.paused,
        AdSet.Field.promoted_object: promoted_object,
        AdSet.Field.targeting: targeting,
    }


def build_ad_payload(*, name: str, adset_id: str, creative_id: str) -> dict[str, Any]:
    return {
        Ad.Field.name: name,
        Ad.Field.adset_id: adset_id,
        Ad.Field.creative: {"creative_id": creative_id},
        Ad.Field.status: Ad.Status.paused,
    }


def create_paused_campaign(
    *,
    name: str,
    daily_budget_try: float,
    app_id: str,
    app_store_url: str,
    page_id: str,
    link: str,
    creative_type: str,  # "single" | "carousel"
    images: list[str],
    headlines: list[str],
    descriptions: Optional[list[str]] = None,
    message: str = "",
    objective: str = DEFAULT_OBJECTIVE,
    optimization_goal: str = DEFAULT_OPTIMIZATION_GOAL,
    billing_event: str = DEFAULT_BILLING_EVENT,
    countries: Optional[list[str]] = None,
    custom_event_type: Optional[str] = None,
    audience_id: Optional[str] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    if creative_type not in ("single", "carousel"):
        raise ValueError("creative_type 'single' ya da 'carousel' olmali.")
    if creative_type == "carousel" and len(headlines) != len(images):
        raise ValueError("Carousel'de her gorsel icin bir headline gerekli (sayilar esit degil).")
    if creative_type == "single" and len(images) != 1:
        raise ValueError("Tekil (single) kreatif icin tam olarak 1 gorsel gerekli.")

    # Kitle hazir degilse burada durur - hicbir API cagrisi yapilmadan once.
    # audience_id verilmezse bu kontrol atlanir (genis/Advantage+ hedefleme).
    if audience_id:
        ensure_ready(audience_id)

    campaign_payload = build_campaign_payload(name=name, objective=objective)
    adset_payload_preview = build_adset_payload(
        name=f"{name} - adset",
        campaign_id="<olusturulacak>",
        daily_budget_try=daily_budget_try,
        audience_id=audience_id,
        app_id=app_id,
        app_store_url=app_store_url,
        optimization_goal=optimization_goal,
        billing_event=billing_event,
        countries=countries,
        custom_event_type=custom_event_type,
    )

    plan = {
        "campaign": campaign_payload,
        "adset": adset_payload_preview,
        "creative_type": creative_type,
        "images": images,
        "headlines": headlines,
        "descriptions": descriptions,
        "link": link,
        "page_id": page_id,
    }

    if dry_run:
        return {"dry_run": True, "plan": plan}

    account = get_ad_account()

    campaign = call(account.create_campaign, params=campaign_payload)
    campaign_id = campaign[Campaign.Field.id]

    adset_payload = build_adset_payload(
        name=f"{name} - adset",
        campaign_id=campaign_id,
        daily_budget_try=daily_budget_try,
        audience_id=audience_id,
        app_id=app_id,
        app_store_url=app_store_url,
        optimization_goal=optimization_goal,
        billing_event=billing_event,
        countries=countries,
        custom_event_type=custom_event_type,
    )
    adset = call(account.create_ad_set, params=adset_payload)
    adset_id = adset[AdSet.Field.id]

    image_hashes = [creatives.upload_image(path) for path in images]

    if creative_type == "single":
        creative_payload = creatives.build_single_image_creative(
            page_id=page_id,
            link=link,
            image_hash=image_hashes[0],
            message=message,
            headline=headlines[0],
        )
    else:
        descs = descriptions or [""] * len(images)
        cards = [
            {"image_hash": h, "name": headline, "description": desc}
            for h, headline, desc in zip(image_hashes, headlines, descs)
        ]
        creative_payload = creatives.build_carousel_creative(
            page_id=page_id, link=link, message=message, cards=cards
        )

    creative = call(account.create_ad_creative, params=creative_payload)
    creative_id = creative["id"]

    ad_payload = build_ad_payload(name=f"{name} - ad", adset_id=adset_id, creative_id=creative_id)
    ad = call(account.create_ad, params=ad_payload)
    ad_id = ad[Ad.Field.id]

    return {
        "dry_run": False,
        "campaign_id": campaign_id,
        "adset_id": adset_id,
        "creative_id": creative_id,
        "ad_id": ad_id,
        "status": "PAUSED",
    }


def _set_campaign_status(campaign_id: str, status: str) -> None:
    ensure_api_initialized()
    campaign = Campaign(campaign_id)
    call(campaign.api_update, params={Campaign.Field.status: status})


def pause(campaign_id: str) -> None:
    _set_campaign_status(campaign_id, Campaign.Status.paused)


def resume(campaign_id: str) -> None:
    """DIKKAT: Bu kampanyayi ACTIVE yapar, harcama baslar. cli.py onay ister."""
    _set_campaign_status(campaign_id, Campaign.Status.active)


def set_budget(campaign_id: str, daily_budget_try: float) -> None:
    """Kampanya seviyesinde (CBO) gunluk butceyi gunceller.

    NOT: Eger kampanya ad-set seviyesinde butce kullaniyorsa (CBO kapali),
    bu cagri etkisiz kalir - o durumda AdSet.daily_budget guncellenmeli.
    """
    ensure_api_initialized()
    campaign = Campaign(campaign_id)
    call(
        campaign.api_update,
        params={Campaign.Field.daily_budget: _try_to_cents(daily_budget_try)},
    )


def get_campaign_status(campaign_id: str) -> dict[str, Any]:
    ensure_api_initialized()
    campaign = Campaign(campaign_id)
    fields = [Campaign.Field.name, Campaign.Field.status, Campaign.Field.daily_budget, Campaign.Field.objective]
    data = call(campaign.api_get, fields=fields)
    return dict(data)
