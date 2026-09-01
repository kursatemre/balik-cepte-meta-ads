"""audiences.get_status/ensure_ready icin mock tabanli testler (gercek API cagrisi yok)."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from meta_ads import audiences


def _fake_api_get(delivery_code: int, lower: int = 500):
    def _inner(self=None, fields=None):
        return {
            "name": "test-kitle",
            "approximate_count_lower_bound": lower,
            "approximate_count_upper_bound": lower + 100,
            "operation_status": {"code": 200, "description": "ok"},
            "delivery_status": {"code": delivery_code, "description": "durum aciklamasi"},
        }

    return _inner


def test_get_status_ready_when_delivery_code_200():
    with patch("meta_ads.audiences.ensure_api_initialized"), patch(
        "meta_ads.audiences.CustomAudience.api_get",
        new=_fake_api_get(delivery_code=200),
    ):
        status = audiences.get_status("123")
    assert status["ready"] is True
    assert status["approx_size_lower"] == 500


def test_get_status_not_ready_when_delivery_code_300():
    with patch("meta_ads.audiences.ensure_api_initialized"), patch(
        "meta_ads.audiences.CustomAudience.api_get",
        new=_fake_api_get(delivery_code=300, lower=10),
    ):
        status = audiences.get_status("456")
    assert status["ready"] is False


def test_ensure_ready_raises_when_not_ready():
    with patch("meta_ads.audiences.ensure_api_initialized"), patch(
        "meta_ads.audiences.CustomAudience.api_get",
        new=_fake_api_get(delivery_code=300, lower=10),
    ):
        with pytest.raises(ValueError):
            audiences.ensure_ready("456")


def test_ensure_ready_returns_status_when_ready():
    with patch("meta_ads.audiences.ensure_api_initialized"), patch(
        "meta_ads.audiences.CustomAudience.api_get",
        new=_fake_api_get(delivery_code=200),
    ):
        status = audiences.ensure_ready("123")
    assert status["ready"] is True
