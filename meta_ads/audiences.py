"""Custom Audience durum kontrolu.

Bir kitleyi kampanyada hedeflemeden once "kullanima hazir mi" sorusunu
yanitlar - Meta yeni olusturulan/genisleyen kitleleri belli bir boyuta
ulasana kadar "too small" olarak isaretler ve kampanyada kullanmaya izin
vermez.
"""
from __future__ import annotations

from facebook_business.adobjects.customaudience import CustomAudience

from .client import call, ensure_api_initialized

# delivery_status.code == 200 -> aktif/hazir, 300 -> kucuk/pasif.
# operation_status.code == 200 -> normal islem durumu.
DELIVERY_READY_CODE = 200
DELIVERY_TOO_SMALL_CODE = 300


def get_status(audience_id: str) -> dict:
    """Kitlenin guncel boyut/durumunu Meta'dan ceker."""
    ensure_api_initialized()
    audience = CustomAudience(audience_id)
    fields = [
        CustomAudience.Field.name,
        CustomAudience.Field.approximate_count_lower_bound,
        CustomAudience.Field.approximate_count_upper_bound,
        CustomAudience.Field.operation_status,
        CustomAudience.Field.delivery_status,
    ]
    data = call(audience.api_get, fields=fields)

    delivery = data.get(CustomAudience.Field.delivery_status) or {}
    delivery_code = delivery.get("code")
    lower = data.get(CustomAudience.Field.approximate_count_lower_bound)

    ready = delivery_code == DELIVERY_READY_CODE

    return {
        "id": audience_id,
        "name": data.get(CustomAudience.Field.name),
        "approx_size_lower": lower,
        "approx_size_upper": data.get(CustomAudience.Field.approximate_count_upper_bound),
        "operation_status": data.get(CustomAudience.Field.operation_status),
        "delivery_status": delivery,
        "ready": ready,
    }


def ensure_ready(audience_id: str) -> dict:
    """Kitle hazir degilse ValueError firlatir - kampanya olusturmadan once cagirilir."""
    status = get_status(audience_id)
    if not status["ready"]:
        delivery = status["delivery_status"] or {}
        reason = delivery.get("description", "durum bilinmiyor")
        raise ValueError(
            f"Kitle '{status['name']}' ({audience_id}) henuz kampanyada kullanima hazir degil.\n"
            f"Meta'nin sebebi: {reason} (yaklasik boyut: {status['approx_size_lower']}).\n"
            "Kitle dolana kadar bekle (genelde birkac saat/gun) ya da 'uygulamayi acan herkes 180' "
            "gibi zaten hazir baska bir kitle kullan."
        )
    return status
