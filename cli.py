#!/usr/bin/env python3
"""Balik Cepte - Meta Ads CLI.

Kullanim ornekleri icin README.md'ye bak. Ozet akis:
  1. audience status  -> kitle kampanyada kullanima hazir mi kontrol et
  2. campaign create --dry-run -> payload'i gozden gecir
  3. campaign create (dry-run olmadan) -> PAUSED kampanya olustur
  4. Meta Ads Manager'da elle kontrol et
  5. campaign resume -> onay isteyerek ACTIVE yap (harcama BURADA baslar)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from meta_ads import audiences, campaigns, reports  # noqa: E402
from meta_ads.client import ConfigError, MetaApiError  # noqa: E402


def _print_json(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def cmd_audience_status(args: argparse.Namespace) -> int:
    status = audiences.get_status(args.audience_id)
    _print_json(status)
    print()
    print("=> HAZIR" if status["ready"] else "=> HENUZ HAZIR DEGIL")
    return 0


def cmd_campaign_create(args: argparse.Namespace) -> int:
    app_id = args.app_id or os.getenv("META_PROMOTED_APP_ID")
    app_store_url = args.app_store_url or os.getenv("META_APP_STORE_URL")
    page_id = args.page_id or os.getenv("META_PAGE_ID")

    missing = [
        n
        for n, v in [
            ("--app-id / META_PROMOTED_APP_ID", app_id),
            ("--app-store-url / META_APP_STORE_URL", app_store_url),
            ("--page-id / META_PAGE_ID", page_id),
        ]
        if not v
    ]
    if missing:
        print("Eksik: " + ", ".join(missing), file=sys.stderr)
        return 1

    result = campaigns.create_paused_campaign(
        name=args.name,
        daily_budget_try=args.daily_budget,
        audience_id=args.audience_id,
        app_id=app_id,
        app_store_url=app_store_url,
        page_id=page_id,
        link=args.link,
        creative_type=args.creative_type,
        images=args.images,
        headlines=args.headlines or [],
        descriptions=args.descriptions,
        message=args.message or "",
        objective=args.objective,
        optimization_goal=args.optimization_goal,
        billing_event=args.billing_event,
        countries=args.countries,
        custom_event_type=args.custom_event_type,
        dry_run=args.dry_run,
    )

    _print_json(result)
    if result.get("dry_run"):
        print("\n(dry-run: hicbir API cagrisi yapilmadi)")
    else:
        print(
            f"\nKampanya olusturuldu (PAUSED): campaign_id={result['campaign_id']}\n"
            "Meta Ads Manager'da elle kontrol etmeden ACTIVE yapma."
        )
    return 0


def cmd_campaign_pause(args: argparse.Namespace) -> int:
    campaigns.pause(args.campaign_id)
    print(f"Kampanya {args.campaign_id} PAUSED yapildi.")
    return 0


def cmd_campaign_resume(args: argparse.Namespace) -> int:
    status = campaigns.get_campaign_status(args.campaign_id)
    print("Kampanya:", json.dumps(status, ensure_ascii=False, indent=2, default=str))
    if not args.yes:
        answer = input(
            f"\n'{status.get('name')}' kampanyasini ACTIVE yapmak uzeresin - harcama baslayacak. Onayliyor musun? [e/H]: "
        )
        if answer.strip().lower() not in ("e", "evet", "y", "yes"):
            print("Iptal edildi.")
            return 1
    campaigns.resume(args.campaign_id)
    print(f"Kampanya {args.campaign_id} ACTIVE yapildi.")
    return 0


def cmd_campaign_set_budget(args: argparse.Namespace) -> int:
    campaigns.set_budget(args.campaign_id, args.daily_budget)
    print(f"Kampanya {args.campaign_id} gunluk butcesi {args.daily_budget} TRY olarak guncellendi.")
    return 0


def cmd_campaign_status(args: argparse.Namespace) -> int:
    _print_json(campaigns.get_campaign_status(args.campaign_id))
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    rows = reports.get_insights(
        since=args.since,
        until=args.until,
        date_preset=args.date_preset,
        breakdown=args.breakdown,
        campaign_id=args.campaign_id,
    )
    reports.print_table(rows)
    if args.export:
        if args.export.endswith(".json"):
            reports.export_json(rows, args.export)
        else:
            reports.export_csv(rows, args.export)
        print(f"\n{len(rows)} satir '{args.export}' dosyasina yazildi.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cli.py", description="Balik Cepte Meta Ads araci")
    sub = parser.add_subparsers(dest="command", required=True)

    p_audience = sub.add_parser("audience", help="Custom audience islemleri")
    audience_sub = p_audience.add_subparsers(dest="audience_command", required=True)
    p_audience_status = audience_sub.add_parser("status", help="Kitlenin kampanyada kullanima hazir olup olmadigini kontrol et")
    p_audience_status.add_argument("--audience-id", required=True)
    p_audience_status.set_defaults(func=cmd_audience_status)

    p_campaign = sub.add_parser("campaign", help="Kampanya islemleri")
    campaign_sub = p_campaign.add_subparsers(dest="campaign_command", required=True)

    p_create = campaign_sub.add_parser("create", help="Yeni PAUSED kampanya+adset+reklam olustur")
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--objective", default=campaigns.DEFAULT_OBJECTIVE)
    p_create.add_argument("--optimization-goal", default=campaigns.DEFAULT_OPTIMIZATION_GOAL)
    p_create.add_argument(
        "--custom-event-type",
        default=None,
        help=(
            "Belirli bir uygulama-ici event'i hedeflemek icin (orn. SUBSCRIBE, PURCHASE). "
            "Verilirse --optimization-goal genelde OFFSITE_CONVERSIONS olmali - App Installs "
            "kitle zaten uygulamayi yuklemis kisilerden olusuyorsa anlamsiz kalir."
        ),
    )
    p_create.add_argument("--billing-event", default=campaigns.DEFAULT_BILLING_EVENT)
    p_create.add_argument("--daily-budget", type=float, required=True, help="TRY cinsinden")
    p_create.add_argument(
        "--audience-id",
        default=None,
        help="Verilmezse Meta'nin genis/Advantage+ hedeflemesine birakilir (custom audience kullanilmaz).",
    )
    p_create.add_argument("--countries", nargs="+", default=None, help="Varsayilan: TR")
    p_create.add_argument("--creative-type", choices=["single", "carousel"], required=True)
    p_create.add_argument("--images", nargs="+", required=True, help="Yerel dosya yollari")
    p_create.add_argument("--headlines", nargs="+", required=True)
    p_create.add_argument("--descriptions", nargs="+", default=None)
    p_create.add_argument("--message", default="")
    p_create.add_argument("--link", required=True)
    p_create.add_argument("--app-id", default=None, help="Varsayilan: META_PROMOTED_APP_ID")
    p_create.add_argument("--app-store-url", default=None, help="Varsayilan: META_APP_STORE_URL")
    p_create.add_argument("--page-id", default=None, help="Varsayilan: META_PAGE_ID")
    p_create.add_argument("--dry-run", action="store_true")
    p_create.set_defaults(func=cmd_campaign_create)

    p_pause = campaign_sub.add_parser("pause", help="Kampanyayi durdur")
    p_pause.add_argument("--campaign-id", required=True)
    p_pause.set_defaults(func=cmd_campaign_pause)

    p_resume = campaign_sub.add_parser("resume", help="Kampanyayi aktif et (harcama baslar, onay ister)")
    p_resume.add_argument("--campaign-id", required=True)
    p_resume.add_argument("--yes", action="store_true", help="Onay istemini atla")
    p_resume.set_defaults(func=cmd_campaign_resume)

    p_budget = campaign_sub.add_parser("set-budget", help="Kampanya (CBO) gunluk butcesini guncelle")
    p_budget.add_argument("--campaign-id", required=True)
    p_budget.add_argument("--daily-budget", type=float, required=True, help="TRY cinsinden")
    p_budget.set_defaults(func=cmd_campaign_set_budget)

    p_status = campaign_sub.add_parser("status", help="Kampanya durumunu goster")
    p_status.add_argument("--campaign-id", required=True)
    p_status.set_defaults(func=cmd_campaign_status)

    p_report = sub.add_parser("report", help="Performans raporu")
    p_report.add_argument("--since", default=None, help="YYYY-MM-DD")
    p_report.add_argument("--until", default=None, help="YYYY-MM-DD")
    p_report.add_argument("--date-preset", default=None, help="orn. last_7d, last_30d")
    p_report.add_argument("--breakdown", default=None, help="orn. age, gender, publisher_platform")
    p_report.add_argument("--campaign-id", default=None, help="Verilmezse hesap genelinde raporlar")
    p_report.add_argument("--export", default=None, help="rapor.csv ya da rapor.json")
    p_report.set_defaults(func=cmd_report)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except ConfigError as exc:
        print(f"Ayar hatasi: {exc}", file=sys.stderr)
        return 2
    except MetaApiError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except ValueError as exc:
        print(f"Hata: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
