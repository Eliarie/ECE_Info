"""Synchronize configured OpenAlex journals into the Supabase sources table."""

from __future__ import annotations

from fetch_journals import (
    OPENALEX_DOMESTIC_JOURNALS,
    OPENALEX_JOURNALS,
    supabase,
)


def build_source(journal: dict) -> dict:
    config = {"journal_name": journal["name"]}
    if journal.get("openalex_id"):
        config["openalex_id"] = journal["openalex_id"]
    if journal.get("filter"):
        config["keyword_filter"] = journal["filter"]

    return {
        "name": journal["name"],
        "url": "https://api.openalex.org/works",
        "type": "openalex",
        "module": journal["module"],
        "region": journal.get("region", "international"),
        "is_active": True,
        "config": config,
    }


def run() -> None:
    journals = [*OPENALEX_JOURNALS, *OPENALEX_DOMESTIC_JOURNALS]
    existing = supabase.table("sources").select("id,name").execute().data or []
    ids_by_name: dict[str, list[str]] = {}
    for source in existing:
        ids_by_name.setdefault(source["name"], []).append(source["id"])

    inserted = 0
    updated = 0
    for journal in journals:
        payload = build_source(journal)
        source_ids = ids_by_name.get(journal["name"], [])
        if not source_ids:
            supabase.table("sources").insert(payload).execute()
            inserted += 1
            continue

        for source_id in source_ids:
            supabase.table("sources").update(payload).eq("id", source_id).execute()
            updated += 1

    print(f"[OK] 期刊来源同步完成：新增 {inserted}，更新 {updated}")


if __name__ == "__main__":
    run()
