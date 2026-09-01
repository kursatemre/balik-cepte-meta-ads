"""Meta Marketing API baglantisi ve ortak hata yonetimi.

Tum diger moduller Meta API'ye bu dosya uzerinden erisir; boylece
FacebookAdsApi.init() tek bir yerden yapilir ve hata mesajlari tutarli olur.
"""
from __future__ import annotations

import os
from typing import Any, Callable

from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.api import FacebookAdsApi
from facebook_business.exceptions import FacebookRequestError


class ConfigError(Exception):
    """`.env` eksik/yanlis doldurulduginda firlatilir."""


class MetaApiError(Exception):
    """FacebookRequestError'i okunur, Turkce bir mesaja cevirir."""

    # Sik karsilasilan hata kodlari icin kisa ipucu.
    _HINTS = {
        190: "Access token gecersiz veya suresi dolmus. .env icindeki META_ACCESS_TOKEN'i yenile.",
        17: "Rate limit asildi, birkac dakika bekleyip tekrar dene.",
        80004: "Reklam hesabi bazli rate limit asildi, birkac dakika bekleyip tekrar dene.",
        100: "Gecersiz parametre - asagidaki mesaja bak, muhtemelen bir alan eksik/hatali.",
        200: "Yetki hatasi - token'in bu islem icin (ads_management vb.) izni olmayabilir.",
    }

    def __init__(self, original: FacebookRequestError):
        self.original = original
        try:
            self.code = original.api_error_code()
            self.subcode = original.api_error_subcode()
            self.message = original.api_error_message()
        except Exception:  # SDK surumune gore metodlar degisebilir
            self.code = None
            self.subcode = None
            self.message = str(original)
        # error_user_title/error_user_msg, Meta'nin gosterdigi jenerik
        # "Invalid parameter" mesajindan cok daha faydali olan, kullaniciya
        # yonelik acik aciklamayi tasir (varsa). Yoksa sessizce atlanir.
        self.user_title = None
        self.user_msg = None
        try:
            body = original.body()
            err = body.get("error", {}) if isinstance(body, dict) else {}
            self.user_title = err.get("error_user_title")
            self.user_msg = err.get("error_user_msg")
        except Exception:
            pass
        super().__init__(self._format())

    def _format(self) -> str:
        hint = self._HINTS.get(self.code, "")
        code_part = f"[{self.code}" + (f"/{self.subcode}" if self.subcode else "") + "]"
        base = f"Meta API hatasi {code_part}: {self.message}"
        if self.user_title or self.user_msg:
            detail = " - ".join(x for x in (self.user_title, self.user_msg) if x)
            base += f"\nDetay: {detail}"
        return f"{base}\nIpucu: {hint}" if hint else base


REQUIRED_VARS = ["META_APP_ID", "META_APP_SECRET", "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]


def _require_env() -> dict[str, str]:
    values = {name: os.getenv(name) for name in REQUIRED_VARS}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise ConfigError(
            "Eksik ortam degiskeni(leri): "
            + ", ".join(missing)
            + "\n.env dosyasini .env.example'a gore doldur (bkz. README.md)."
        )
    return values  # type: ignore[return-value]


_initialized = False


def ensure_api_initialized() -> dict[str, str]:
    """FacebookAdsApi.init()'i (bir kere) cagirir. Herhangi bir SDK nesnesi

    (CustomAudience, Campaign, AdSet, Ad, ...) olusturmadan once bu cagrilmali,
    yoksa SDK 'Api call cannot be made if api is not set' hatasi verir.
    """
    global _initialized
    values = _require_env()
    if not _initialized:
        FacebookAdsApi.init(
            app_id=values["META_APP_ID"],
            app_secret=values["META_APP_SECRET"],
            access_token=values["META_ACCESS_TOKEN"],
            crash_log=False,
        )
        _initialized = True
    return values


def get_ad_account() -> AdAccount:
    """FacebookAdsApi'yi baslatir ve hedef reklam hesabini dondurur."""
    values = ensure_api_initialized()
    return AdAccount(values["META_AD_ACCOUNT_ID"])


def call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """SDK cagrilarini sarmalar, FacebookRequestError'i MetaApiError'a cevirir.

    Kullanim: call(account.create_campaign, params={...})
    """
    try:
        return fn(*args, **kwargs)
    except FacebookRequestError as exc:
        raise MetaApiError(exc) from exc
