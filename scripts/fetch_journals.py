"""
OpenAlex + RSS 抓取脚本
覆盖所有国际学术期刊和国内知网RSS
"""

import os
import re
import time
import feedparser
import requests
from datetime import datetime, timedelta, timezone
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

OPENALEX_EMAIL = os.environ.get("OPENALEX_EMAIL", "")  # 可选，加了速率更高

# 国际期刊：OpenAlex期刊名列表（需要关键词过滤的单独标注）
OPENALEX_JOURNALS = [
    {"name": "Early Childhood Research Quarterly",          "module": "research_frontier", "filter": None},
    {"name": "Child Development",                           "module": "research_frontier", "filter": None},
    {"name": "Developmental Science",                       "module": "research_frontier", "filter": None},
    {"name": "Early Childhood Education Journal",           "module": "research_frontier", "filter": None},
    {"name": "International Journal of Early Childhood",    "module": "research_frontier", "filter": None},
    {"name": "Journal of Research in Childhood Education",  "module": "research_frontier", "filter": None},
    {"name": "Early Education and Development",             "module": "research_frontier", "filter": None},
    {"name": "Young Children",                              "module": "research_practice", "filter": None},
    {"name": "Journal of Children and Media",               "module": "research_frontier", "filter": None},
    # 教育技术期刊：只抓学前相关
    {"name": "Computers & Education",                       "module": "research_frontier", "filter": r"early childhood|preschool|kindergarten|young children"},
    {"name": "British Journal of Educational Technology",   "module": "research_frontier", "filter": r"early childhood|preschool|kindergarten|young children"},
    {"name": "Journal of Computer Assisted Learning",       "module": "research_frontier", "filter": r"early childhood|preschool|kindergarten|young children"},
]

# 国内知网RSS（需要关键词过滤的单独标注）
CNKI_RSS_SOURCES = [
    {"name": "学前教育研究", "url": "https://www.cnki.net/kns/rss.aspx?journal=XQJY", "filter": None},
    {"name": "幼儿教育",     "url": "https://www.cnki.net/kns/rss.aspx?journal=YEJY", "filter": None},
    {"name": "教育研究",     "url": "https://www.cnki.net/kns/rss.aspx?journal=JYYJ", "filter": r"学前|幼儿|幼儿园|早期教育"},
    {"name": "全球教育展望", "url": "https://www.cnki.net/kns/rss.aspx?journal=WGJN", "filter": r"学前|幼儿|幼儿园|早期教育"},
    {"name": "电化教育研究", "url": "https://www.cnki.net/kns/rss.aspx?journal=DHJY", "filter": r"学前|幼儿|幼儿园|早期教育"},
    {"name": "中国电化教育", "url": "https://www.cnki.net/kns/rss.aspx?journal=ZDDJ", "filter": r"学前|幼儿|幼儿园|早期教育"},
    {"name": "开放教育研究", "url": "https://www.cnki.net/kns/rss.aspx?journal=KFJY", "filter": r"学前|幼儿|幼儿园|早期教育"},
]

# Frontiers in Education RSS
FRONTIERS_RSS = {
    "name": "Frontiers in Education",
    "url": "https://www.frontiersin.org/journals/education/rss",
    "filter": r"early childhood|preschool|kindergarten|young children",
    "module": "research_frontier",
    "region": "international",
}


def get_openalex_journal_id(journal_name: str) -> str | None:
    """通过期刊名查询OpenAlex的source ID"""
    params = {"search": journal_name, "filter": "type:journal"}
    if OPENALEX_EMAIL:
        params["mailto"] = OPENALEX_EMAIL
    resp = requests.get("https://api.openalex.org/sources", params=params, timeout=10)
    data = resp.json()
    results = data.get("results", [])
    if results:
        return results[0]["id"]  # 返回第一个匹配的ID
    return None


def fetch_openalex_papers(journal: dict, days_back: int = 7) -> list[dict]:
    """从OpenAlex抓取指定期刊最近N天的论文"""
    since_date = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")

    journal_id = get_openalex_journal_id(journal["name"])
    if not journal_id:
        print(f"[WARN] 找不到期刊: {journal['name']}")
        return []

    params = {
        "filter": f"primary_location.source.id:{journal_id},from_publication_date:{since_date}",
        "sort": "publication_date:desc",
        "per-page": 50,
        "select": "title,abstract_inverted_index,doi,publication_date,primary_location,authorships",
    }
    if OPENALEX_EMAIL:
        params["mailto"] = OPENALEX_EMAIL

    resp = requests.get("https://api.openalex.org/works", params=params, timeout=15)
    works = resp.json().get("results", [])

    articles = []
    for w in works:
        title = w.get("title", "")
        abstract = _decode_inverted_index(w.get("abstract_inverted_index"))
        doi = w.get("doi", "")
        url = f"https://doi.org/{doi.replace('https://doi.org/', '')}" if doi else w.get("primary_location", {}).get("landing_page_url", "")
        pub_date = w.get("publication_date")
        authors = [a["author"]["display_name"] for a in w.get("authorships", []) if a.get("author")]

        # 关键词过滤（教育技术类期刊）
        if journal["filter"] and not re.search(journal["filter"], title + (abstract or ""), re.IGNORECASE):
            continue

        if not title or not url:
            continue

        articles.append({
            "title_original": title,
            "abstract_original": abstract,
            "authors": authors,
            "source_name": journal["name"],
            "source_url": url,
            "doi": doi,
            "module": journal["module"],
            "region": "international",
            "published_at": pub_date,
            "is_translated": False,
        })

    return articles


def _decode_inverted_index(inverted: dict | None) -> str | None:
    """OpenAlex摘要是倒排索引格式，还原为正常文本"""
    if not inverted:
        return None
    words = {}
    for word, positions in inverted.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


def fetch_rss(source: dict, region: str, module: str) -> list[dict]:
    """通用RSS抓取"""
    feed = feedparser.parse(source["url"])
    articles = []
    for entry in feed.entries:
        title = entry.get("title", "")
        abstract = entry.get("summary", "") or entry.get("description", "")
        url = entry.get("link", "")
        pub_date = entry.get("published", entry.get("updated", ""))

        # 关键词过滤
        if source.get("filter") and not re.search(source["filter"], title + abstract, re.IGNORECASE):
            continue

        if not title or not url:
            continue

        articles.append({
            "title_original": title,
            "abstract_original": abstract or None,
            "authors": [],
            "source_name": source["name"],
            "source_url": url,
            "doi": None,
            "module": module,
            "region": region,
            "published_at": pub_date or None,
            "is_translated": False,
        })

    return articles


def save_articles(articles: list[dict]):
    """存入Supabase，已存在的跳过（source_url唯一）"""
    if not articles:
        return
    # upsert：source_url已存在则跳过
    supabase.table("articles").upsert(articles, on_conflict="source_url", ignore_duplicates=True).execute()
    print(f"[OK] 保存 {len(articles)} 篇")


def run():
    total = 0

    # 1. OpenAlex 国际期刊
    print("=== 抓取 OpenAlex 国际期刊 ===")
    for journal in OPENALEX_JOURNALS:
        print(f"  {journal['name']}...")
        articles = fetch_openalex_papers(journal, days_back=7)
        save_articles(articles)
        total += len(articles)
        time.sleep(0.5)  # 礼貌性延迟

    # 2. Frontiers in Education RSS
    print("=== 抓取 Frontiers in Education RSS ===")
    articles = fetch_rss(FRONTIERS_RSS, region="international", module="research_frontier")
    save_articles(articles)
    total += len(articles)

    # 3. 国内知网 RSS
    print("=== 抓取 国内知网 RSS ===")
    for source in CNKI_RSS_SOURCES:
        print(f"  {source['name']}...")
        articles = fetch_rss(source, region="domestic", module="research_frontier")
        save_articles(articles)
        total += len(articles)
        time.sleep(0.3)

    print(f"\n完成，共抓取 {total} 篇新文章")


if __name__ == "__main__":
    run()
