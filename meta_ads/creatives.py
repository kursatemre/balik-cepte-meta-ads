"""Gorsel yukleme ve reklam kreatifi (tekil / carousel) olusturma."""
from __future__ import annotations

import base64
from typing import Any

from .client import call, get_ad_account

DEFAULT_CTA_TYPE = "LEARN_MORE"
CAROUSEL_MIN_CARDS = 2
CAROUSEL_MAX_CARDS = 10


def upload_image(path: str) -> str:
    """Yerel bir gorsel dosyasini Meta'ya yukler, referans icin image_hash doner.

    NOT: SDK/Graph API surumune gore donen yapinin sekli degisebilir; bu
    fonksiyon bilinen birkac sekli dener, hicbiri tutmazsa ham yaniti
    goren bir hata mesaji verir (kor kor devam etmek yerine).
    """
    account = get_ad_account()
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    # Bu SDK surumunde create_ad_image `files=` kabul etmiyor; Graph API'nin
    # /adimages ucu icin belgeledigi yontem, gorsel verisini base64 olarak
    # `bytes` params alaninda gondermek.
    result = call(account.create_ad_image, params={"bytes": encoded})

    # Olasi sekil 1: dogrudan hash alani olan bir obje (AdImage).
    try:
        h = result.get("hash") if hasattr(result, "get") else None
        if h:
            return h
    except Exception:
        pass

    # Olasi sekil 2: {"images": {"<filename>": {"hash": ..., "url": ...}}}
    try:
        images = result.get("images") if hasattr(result, "get") else result["images"]
        if images:
            first = next(iter(images.values()))
            h = first.get("hash") if hasattr(first, "get") else first["hash"]
            if h:
                return h
    except Exception:
        pass

    raise RuntimeError(
        f"'{path}' yuklendi ama yanittan image_hash cikarilamadi. "
        f"Ham yanit: {result!r}\n"
        "meta_ads/creatives.py:upload_image icindeki sekil kontrolunu bu yanita gore guncelle."
    )


def build_single_image_creative(
    *,
    page_id: str,
    link: str,
    image_hash: str,
    message: str,
    headline: str,
    cta_type: str = DEFAULT_CTA_TYPE,
) -> dict[str, Any]:
    return {
        "object_story_spec": {
            "page_id": page_id,
            "link_data": {
                "message": message,
                "link": link,
                "image_hash": image_hash,
                "name": headline,
                "call_to_action": {"type": cta_type, "value": {"link": link}},
            },
        },
    }


def build_carousel_creative(
    *,
    page_id: str,
    link: str,
    message: str,
    cards: list[dict[str, Any]],
    cta_type: str = DEFAULT_CTA_TYPE,
) -> dict[str, Any]:
    """cards: [{"image_hash": ..., "name": ..., "description": ...}, ...] (2-10 eleman)."""
    if not (CAROUSEL_MIN_CARDS <= len(cards) <= CAROUSEL_MAX_CARDS):
        raise ValueError(
            f"Carousel {CAROUSEL_MIN_CARDS}-{CAROUSEL_MAX_CARDS} kart arasinda olmali, {len(cards)} verildi."
        )

    child_attachments = [
        {
            "link": link,
            "image_hash": card["image_hash"],
            "name": card.get("name", ""),
            "description": card.get("description", ""),
            "call_to_action": {"type": cta_type, "value": {"link": link}},
        }
        for card in cards
    ]

    return {
        "object_story_spec": {
            "page_id": page_id,
            "link_data": {
                "message": message,
                "link": link,
                "multi_share_optimized": True,
                "multi_share_end_card": True,
                "child_attachments": child_attachments,
            },
        },
    }
