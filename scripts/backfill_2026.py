"""
2026 年全量回填脚本
从 OpenAlex 抓取所有期刊 2026-01-01 至今的论文，写入 Supabase。
用法：
  SUPABASE_URL=... SUPABASE_KEY=... OPENALEX_EMAIL=... python scripts/backfill_2026.py
"""

import os
import re
import time
import requests
from supabase import create_client
from topic_classifier import classify_topics

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
OPENALEX_EMAIL = os.environ.get("OPENALEX_EMAIL", "")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

SINCE_DATE = "2026-01-01"

# 所有期刊（含 module 分类）
JOURNALS = [
    # 期刊论文 - 国际
    {"name": "Early Childhood Research Quarterly",         "module": "research_frontier", "filter": None},
    {"name": "Child Development",                          "module": "research_frontier", "filter": None},
    {"name": "Developmental Science",                      "module": "research_frontier", "filter": None},
    {"name": "Early Childhood Education Journal",          "module": "research_frontier", "filter": None},
    {"name": "International Journal of Early Childhood",   "module": "research_frontier", "filter": None},
    {"name": "Journal of Research in Childhood Education", "module": "research_frontier", "filter": None},
    {"name": "Early Education and Development",            "module": "research_frontier", "filter": None},
    {"name": "Journal of Children and Media",              "module": "research_frontier", "filter": None},
    {"name": "Computers & Education",                      "module": "research_frontier", "filter": r"early childhood|preschool|kindergarten|young children"},
    {"name": "British Journal of Educational Technology",  "module": "research_frontier", "filter": r"early childhood|preschool|kindergarten|young children"},
    {"name": "Journal of Computer Assisted Learning",      "module": "research_frontier", "filter": r"early childhood|preschool|kindergarten|young children"},
    # 实践探索 - 国际
    {"name": "Young Children",                             "module": "research_practice", "filter": None},
    {"name": "Childhood Education",                        "module": "research_practice", "filter": None},
    {"name": "Journal of Early Childhood Teacher Education", "module": "research_practice", "filter": None},
    {"name": "European Early Childhood Education Research Journal", "module": "research_practice", "filter": None},
]


def get_journal_id(name: str) -> str | None:
    params = {"search": name, "filter": "type:journal"}
    if OPENALEX_EMAIL:
        params["mailto"] = OPENALEX_EMAIL
    try:
        resp = requests.get("https://api.openalex.org/sources", params=params, timeout=10)
        results = resp.json().get("results", [])
        return results[0]["id"] if results else None
    except Exception as e:
        print(f"  [ERR] 查询期刊ID失败 {name}: {e}")
        return None


def decode_inverted_index(inverted: dict | None) -> str | None:
    if not inverted:
        return None
    words: dict[int, str] = {}
    for word, positions in inverted.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


def fetch_all_papers(journal: dict, journal_id: str) -> list[dict]:
    """分页抓取该期刊 2026 年全部论文"""
    articles = []
    cursor = "*"
    page_num = 0

    while True:
        params = {
            "filter": f"primary_location.source.id:{journal_id},from_publication_date:{SINCE_DATE}",
            "sort": "publication_date:desc",
            "per-page": 200,
            "cursor": cursor,
            "select": "title,abstract_inverted_index,doi,publication_date,primary_location,authorships,cited_by_count",
        }
        if OPENALEX_EMAIL:
            params["mailto"] = OPENALEX_EMAIL

        try:
            resp = requests.get("https://api.openalex.org/works", params=params, timeout=20)
            data = resp.json()
        except Exception as e:
            print(f"  [ERR] 请求失败: {e}")
            break

        works = data.get("results", [])
        if not works:
            break

        page_num += 1
        for w in works:
            title = w.get("title", "")
            abstract = decode_inverted_index(w.get("abstract_inverted_index"))
            doi = w.get("doi", "")
            url = (
                f"https://doi.org/{doi.replace('https://doi.org/', '')}"
                if doi
                else (w.get("primary_location") or {}).get("landing_page_url", "")
            )
            pub_date = w.get("publication_date")
            authors = [
                a["author"]["display_name"]
                for a in w.get("authorships", [])
                if a.get("author")
            ]
            cited_by_count = w.get("cited_by_count", 0) or 0

            if journal["filter"] and not re.search(
                journal["filter"], title + (abstract or ""), re.IGNORECASE
            ):
                continue
            if not title or not url:
                continue

            articles.append({
                "title_original": title,
                "abstract_original": abstract,
                "authors": authors,
                "source_name": journal["name"],
                "source_url": url,
                "doi": doi or None,
                "module": journal["module"],
                "region": "international",
                "published_at": pub_date,
                "cited_by_count": cited_by_count,
                "topic_tags": classify_topics(title, abstract),
                "is_translated": False,
            })

        next_cursor = data.get("meta", {}).get("next_cursor")
        if not next_cursor:
            break
        cursor = next_cursor
        time.sleep(0.3)

    print(f"    共 {len(articles)} 篇（{page_num} 页）")
    return articles


def save_articles(articles: list[dict]):
    if not articles:
        return
    # 分批写入，每批 100 条
    for i in range(0, len(articles), 100):
        batch = articles[i:i + 100]
        supabase.table("articles").upsert(
            batch, on_conflict="source_url", ignore_duplicates=True
        ).execute()
    print(f"    [OK] 写入 {len(articles)} 条")


def run():
    # 检查表
    try:
        supabase.table("articles").select("id").limit(1).execute()
    except Exception as e:
        print(f"[ERR] 无法访问 articles 表: {e}")
        return

    total = 0
    for journal in JOURNALS:
        print(f"\n>>> {journal['name']} ({journal['module']})")
        jid = get_journal_id(journal["name"])
        if not jid:
            print("    [SKIP] 找不到期刊 ID")
            continue
        articles = fetch_all_papers(journal, jid)
        save_articles(articles)
        total += len(articles)
        time.sleep(0.5)

    print(f"\n=== 回填完成，共写入 {total} 篇 ===")


if __name__ == "__main__":
    run()
