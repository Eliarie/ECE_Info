"""Prune old, unbookmarked articles through a protected database function."""

from __future__ import annotations

import os

from supabase import create_client

RETENTION_DAYS = int(os.environ.get("ARTICLE_RETENTION_DAYS", "365"))
MAX_DELETE = int(os.environ.get("ARTICLE_CLEANUP_MAX_DELETE", "200"))
CLEANUP_TOKEN = os.environ["ARTICLE_CLEANUP_TOKEN"]

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])


def run() -> None:
    result = supabase.rpc(
        "prune_unbookmarked_articles",
        {
            "p_retention_days": RETENTION_DAYS,
            "p_max_delete": MAX_DELETE,
            "p_cleanup_token": CLEANUP_TOKEN,
        },
    ).execute()
    deleted = result.data or 0
    print(
        f"[OK] 文献放流完成：删除 {deleted} 篇未收藏旧文献，"
        f"保留期 {RETENTION_DAYS} 天，本次上限 {MAX_DELETE} 篇"
    )


if __name__ == "__main__":
    run()
