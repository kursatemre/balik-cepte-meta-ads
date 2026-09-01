"""Performans raporlama (insights) - AdWhispr'daki get_account_performance benzeri."""
from __future__ import annotations

import csv
import json
from typing import Any, Optional

from facebook_business.adobjects.campaign import Campaign

from .client import call, ensure_api_initialized, get_ad_account

DEFAULT_FIELDS = [
    "campaign_name",
    "impressions",
    "clicks",
    "spend",
    "ctr",
    "cpc",
    "actions",
]


def get_insights(
    *,
    since: Optional[str] = None,
    until: Optional[str] = None,
    date_preset: Optional[str] = None,
    breakdown: Optional[str] = None,
    campaign_id: Optional[str] = None,
    fields: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    """since/until: 'YYYY-MM-DD'. Ikisi de verilmezse date_preset (varsayilan last_30d) kullanilir."""
    fields = fields or DEFAULT_FIELDS
    params: dict[str, Any] = {"level": "campaign"}

    if since and until:
        params["time_range"] = {"since": since, "until": until}
    else:
        params["date_preset"] = date_preset or "last_30d"

    if breakdown:
        params["breakdowns"] = [breakdown]

    if campaign_id:
        ensure_api_initialized()
        target = Campaign(campaign_id)
    else:
        target = get_ad_account()
    insights = call(target.get_insights, fields=fields, params=params)
    return [dict(row) for row in insights]


def export_csv(rows: list[dict[str, Any]], path: str) -> None:
    if not rows:
        open(path, "w", encoding="utf-8").close()
        return
    keys = sorted({k for row in rows for k in row.keys()})
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)


def export_json(rows: list[dict[str, Any]], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)


def print_table(rows: list[dict[str, Any]]) -> None:
    if not rows:
        print("Bu tarih araligi icin kayit bulunamadi.")
        return
    keys = list(rows[0].keys())
    widths = {k: max(len(k), *(len(str(r.get(k, ""))) for r in rows)) for k in keys}
    header = " | ".join(k.ljust(widths[k]) for k in keys)
    print(header)
    print("-" * len(header))
    for row in rows:
        print(" | ".join(str(row.get(k, "")).ljust(widths[k]) for k in keys))
