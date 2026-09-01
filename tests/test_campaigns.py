"""campaigns.py icin mock tabanli testler - hicbir gercek API cagrisi yapilmaz.

Buradaki en kritik test: yeni olusturulan her kampanya/adset PAUSED olmali.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from meta_ads import campaigns
from facebook_business.adobjects.campaign import Campaign
from facebook_business.adobjects.adset import AdSet


def test_build_campaign_payload_is_always_paused():
    payload = campaigns.build_campaign_payload(name="test-kampanya")
    assert payload[Campaign.Field.status] == Campaign.Status.paused
    assert payload["special_ad_categories"] == []


def test_build_adset_payload_is_always_paused_and_has_promoted_object():
    payload = campaigns.build_adset_payload(
        name="test-adset",
        campaign_id="123",
        daily_budget_try=40,
        audience_id="aud-1",
        app_id="app-1",
        app_store_url="https://apps.apple.com/tr/app/id6765955082",
    )
    assert payload[AdSet.Field.status] == AdSet.Status.paused
    assert payload[AdSet.Field.daily_budget] == 4000  # TRY -> kurus
    assert payload[AdSet.Field.promoted_object]["application_id"] == "app-1"
    assert payload[AdSet.Field.targeting]["custom_audiences"] == [{"id": "aud-1"}]
    assert payload[AdSet.Field.targeting]["geo_locations"]["countries"] == ["TR"]


def test_create_paused_campaign_dry_run_does_not_call_api():
    with patch("meta_ads.campaigns.ensure_ready", return_value={"ready": True}) as ensure_ready, \
         patch("meta_ads.campaigns.get_ad_account") as get_ad_account:
        result = campaigns.create_paused_campaign(
            name="claude-carousel-test",
            daily_budget_try=40,
            audience_id="120246948804510513",
            app_id="app-1",
            app_store_url="https://apps.apple.com/tr/app/id6765955082",
            page_id="190068084900577",
            link="https://apps.apple.com/tr/app/id6765955082",
            creative_type="carousel",
            images=["kart1.jpg", "kart2.jpg", "kart3.jpg"],
            headlines=["Baslik 1", "Baslik 2", "Baslik 3"],
            dry_run=True,
        )

    ensure_ready.assert_called_once_with("120246948804510513")
    get_ad_account.assert_not_called()
    assert result["dry_run"] is True
    assert result["plan"]["campaign"][Campaign.Field.status] == Campaign.Status.paused


def test_create_paused_campaign_rejects_mismatched_headlines():
    with patch("meta_ads.campaigns.ensure_ready", return_value={"ready": True}):
        with pytest.raises(ValueError):
            campaigns.create_paused_campaign(
                name="x",
                daily_budget_try=40,
                audience_id="aud-1",
                app_id="app-1",
                app_store_url="https://example.com",
                page_id="p1",
                link="https://example.com",
                creative_type="carousel",
                images=["a.jpg", "b.jpg"],
                headlines=["sadece bir baslik"],
                dry_run=True,
            )


def test_pause_calls_api_update_with_paused_status():
    with patch("meta_ads.campaigns.ensure_api_initialized"), \
         patch("meta_ads.campaigns.Campaign.api_update") as api_update:
        campaigns.pause("cmp-1")
    api_update.assert_called_once_with(params={Campaign.Field.status: Campaign.Status.paused})


def test_resume_calls_api_update_with_active_status():
    with patch("meta_ads.campaigns.ensure_api_initialized"), \
         patch("meta_ads.campaigns.Campaign.api_update") as api_update:
        campaigns.resume("cmp-1")
    api_update.assert_called_once_with(params={Campaign.Field.status: Campaign.Status.active})


def test_set_budget_converts_try_to_cents():
    with patch("meta_ads.campaigns.ensure_api_initialized"), \
         patch("meta_ads.campaigns.Campaign.api_update") as api_update:
        campaigns.set_budget("cmp-1", 100)
    api_update.assert_called_once_with(params={Campaign.Field.daily_budget: 10000})
