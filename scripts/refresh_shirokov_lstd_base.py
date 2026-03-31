#!/usr/bin/env python3
"""Refresh the Shirokov LSTD source-of-truth snapshot.

Fetches the public LSTD/YGroup selection and writes:
- a structured JSON snapshot for exact facts
- a compact Markdown catalog for LLM-friendly lookup

Usage:
    python3 scripts/refresh_shirokov_lstd_base.py
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen


SELECTION_ID = "f6132c75-66ff-4b6f-8442-2ad41bbbca82"
SOURCE_URL = f"https://ru.lstd.pro/{SELECTION_ID}"
API_BASE = "https://api-ru.ygroup.ru"
CAPTURED_AT = "2026-03-31"

WORKSPACE_ROOT = (
    Path(__file__).resolve().parent.parent
    / "control-plane/internal/featurepacks/assets/shirokov-capital-core/workspace"
)
JSON_OUTPUT = WORKSPACE_ROOT / "data/shirokov_lstd_selection_f6132c75.json"
MARKDOWN_OUTPUT = WORKSPACE_ROOT / "SHIROKOV_LSTD_BASE.md"


@dataclass
class SelectionSnapshot:
    selection: dict
    facilities: list[dict]


def fetch_json(path: str) -> dict:
    req = Request(
        f"{API_BASE}{path}",
        headers={"Accept": "application/json;charset=UTF-8"},
    )
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def load_snapshot() -> SelectionSnapshot:
    selection = fetch_json(f"/v1/public/selections/{SELECTION_ID}")["data"]["selection"]
    facilities = fetch_json(
        f"/v1/public/selections/{SELECTION_ID}/facilities?page=1&per_page=100"
    )["data"]["facilities"]
    return SelectionSnapshot(selection=selection, facilities=facilities)


def normalized_json(snapshot: SelectionSnapshot) -> dict:
    selection = snapshot.selection
    owner = selection["owner_user"]
    facilities: list[dict] = []
    for facility in snapshot.facilities:
        facilities.append(
            {
                "id": facility["id"],
                "name": facility["name"],
                "city": (facility.get("city") or {}).get("name"),
                "district": (facility.get("district") or {}).get("name"),
                "address": facility.get("address"),
                "description": facility.get("description"),
                "class": facility.get("class"),
                "fz214": facility.get("fz214"),
                "commissioned": facility.get("is_commissioned"),
                "min_area_m2": facility.get("min_area_m2"),
                "max_area_m2": facility.get("max_area_m2"),
                "min_total_price": facility.get("min_total_price"),
                "min_price_per_m2": facility.get("min_price_per_m2"),
                "active_lots_amount": facility.get("active_lots_amount"),
                "lots_count": facility.get("lots_count"),
                "commission_percent": facility.get("commission_percent"),
                "commission_share": facility.get("commission_share"),
                "commissioning_year": facility.get("commissioning_year"),
                "commissioning_quarter": facility.get("commissioning_quarter"),
                "has_gas": facility.get("has_gas"),
                "has_electricity": facility.get("has_electricity"),
                "has_swimming_pool": facility.get("has_swimming_pool"),
                "heating_type": facility.get("heating_type"),
                "territory_type": facility.get("territory_type"),
                "sewerage_type": facility.get("sewerage_type"),
                "water_supply_type": facility.get("water_supply_type"),
                "latitude": (facility.get("location") or {}).get("latitude"),
                "longitude": (facility.get("location") or {}).get("longitude"),
            }
        )
    return {
        "source_url": SOURCE_URL,
        "captured_at": CAPTURED_AT,
        "selection": {
            "id": selection["id"],
            "name": selection["name"],
            "facilities_count": selection["facilities_count"],
            "owner": {
                "name": " ".join(
                    part for part in [owner.get("first_name"), owner.get("last_name")] if part
                ),
                "phone": owner.get("phone_number"),
                "email": owner.get("email"),
            },
        },
        "facilities": facilities,
    }


def format_rub(value: int | float | None) -> str:
    if value is None:
        return "не указано"
    return f"{int(round(value)):,}".replace(",", " ") + " ₽"


def format_area(min_area: float | None, max_area: float | None) -> str:
    if min_area is None and max_area is None:
        return "не указано"
    if min_area == max_area or max_area is None:
        return f"{min_area} м²"
    return f"{min_area}-{max_area} м²"


def clean_multiline(text: str | None) -> str | None:
    if not text:
        return None
    return "\n".join(part.rstrip() for part in text.splitlines()).strip()


def render_markdown(data: dict) -> str:
    selection = data["selection"]
    owner = selection["owner"]
    lines = [
        "# Shirokov LSTD Base",
        "",
        "Это текущая source-of-truth база объектов для `Shirokov Capital`.",
        "",
        "Используй ее, когда пользователь спрашивает про конкретные объекты, цены, диапазоны, комиссии, географию или просит shortlist по текущему каталогу.",
        "",
        "Правила:",
        "- опирайся только на факты из этой базы или прямо говори, что данных здесь нет",
        "- не придумывай точную цену, availability, доходность или условия сделки сверх указанных значений",
        "- если пользователь просит текущую подборку, сначала предлагай объекты из этой базы",
        "",
        "## Source",
        f"- URL: `{data['source_url']}`",
        f"- Captured at: `{data['captured_at']}`",
        f"- Selection ID: `{selection['id']}`",
        f"- Selection name: `{selection['name']}`",
        f"- Facilities count: `{selection['facilities_count']}`",
        f"- Owner: `{owner['name']}`",
        f"- Owner phone: `{owner['phone']}`",
        f"- Owner email: `{owner['email']}`",
        "",
        "## Catalog",
        "",
    ]
    for index, facility in enumerate(data["facilities"], 1):
        commissioned = "да" if facility["commissioned"] else "нет"
        description = clean_multiline(facility.get("description"))
        commission_share = clean_multiline(facility.get("commission_share"))
        lines.extend(
            [
                f"### {index}. {facility['name']}",
                f"- ID: `{facility['id']}`",
                f"- География: {facility['city']} / {facility['district']}",
                f"- Адрес: {facility['address'] or 'не указано'}",
                f"- Диапазон площадей: {format_area(facility['min_area_m2'], facility['max_area_m2'])}",
                f"- Цена от: {format_rub(facility['min_total_price'])}",
                f"- Цена за м² от: {format_rub(facility['min_price_per_m2'])}",
                f"- Активных лотов: {facility['active_lots_amount'] or 0}",
                f"- Всего лотов: {facility['lots_count'] or 0}",
                f"- FZ-214: {'да' if facility['fz214'] else 'нет'}",
                f"- Сдан: {commissioned}",
                f"- Комиссия: {facility['commission_percent'] if facility['commission_percent'] is not None else 'не указано'}",
            ]
        )
        if facility.get("commissioning_year"):
            lines.append(
                f"- Ввод: {facility['commissioning_year']} Q{facility['commissioning_quarter']}"
            )
        if description:
            lines.append(f"- Краткое описание: {description}")
        if commission_share:
            lines.append(f"- Комментарий по комиссии: {commission_share}")
        lines.append("")
    cleaned = [line.rstrip() for line in lines]
    return "\n".join(cleaned).strip() + "\n"


def main() -> None:
    snapshot = load_snapshot()
    data = normalized_json(snapshot)
    JSON_OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    MARKDOWN_OUTPUT.write_text(render_markdown(data))
    print(f"wrote {JSON_OUTPUT}")
    print(f"wrote {MARKDOWN_OUTPUT}")


if __name__ == "__main__":
    main()
