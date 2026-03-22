"""
政策抓取脚本
覆盖：教育部、国务院、7个城市教育局、国际机构
"""

import os
import sys
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from supabase import create_client

# 修复 Windows 控制台编码问题
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def normalize_date(raw: str | None) -> str | None:
    """将常见日期格式归一为 YYYY-MM-DD。"""
    if not raw:
        return None
    text = raw.strip()
    m = re.search(r"(20\d{2})[./年-](\d{1,2})[./月-](\d{1,2})", text)
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"


def extract_date_from_text(raw: str | None) -> str | None:
    if not raw:
        return None
    return normalize_date(raw)

def ensure_articles_table() -> bool:
    """检查 Supabase 是否存在 public.articles，避免运行时直接崩溃。"""
    try:
        supabase.table("articles").select("id").limit(1).execute()
        return True
    except Exception as e:
        msg = str(e)
        if "PGRST205" in msg or "public.articles" in msg:
            print("[ERR] Supabase 中不存在 public.articles 表。")
            print("[ERR] 请在 Supabase SQL Editor 执行 scripts/init_db.sql 后重试。")
            return False
        raise


def save_articles(articles: list[dict]):
    if not articles:
        return
    supabase.table("articles").upsert(articles, on_conflict="source_url", ignore_duplicates=True).execute()
    print(f"  [OK] 保存 {len(articles)} 条")


def scrape_moe():
    """教育部 - 规范性文件列表"""
    articles = []
    urls = [
        "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/",   # 规范性文件
        "https://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/s5987/", # 工作动态
    ]
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=10)
            resp.encoding = "utf-8"
            soup = BeautifulSoup(resp.text, "html.parser")
            for li in soup.select(".news-list li, ul.newsList li"):
                a = li.find("a")
                if not a:
                    continue
                title = a.get_text(strip=True)
                href = a.get("href", "")
                if href.startswith("/"):
                    href = "https://www.moe.gov.cn" + href
                span = li.find("span")
                pub_date = normalize_date(span.get_text(strip=True) if span else None)
                articles.append({
                    "title_original": title, "title_zh": title,
                    "source_name": "教育部", "source_url": href,
                    "module": "policy", "region": "domestic",
                    "published_at": pub_date, "is_translated": True,
                })
        except Exception as e:
            print(f"  [ERR] 教育部: {e}")
    return articles


def scrape_city(name: str, list_url: str, base_url: str):
    """通用城市教育局爬虫"""
    articles = []
    try:
        resp = requests.get(list_url, headers=HEADERS, timeout=10)
        resp.encoding = "utf-8"
        soup = BeautifulSoup(resp.text, "html.parser")
        for a in soup.select("a[href]"):
            title = a.get_text(strip=True)
            if len(title) < 5:
                continue
            href = a.get("href", "")
            if href.startswith("/"):
                href = base_url + href
            elif not href.startswith("http"):
                continue
            line_text = a.parent.get_text(" ", strip=True) if a.parent else title
            pub_date = extract_date_from_text(line_text)
            articles.append({
                "title_original": title, "title_zh": title,
                "source_name": name, "source_url": href,
                "module": "policy", "region": "domestic",
                "published_at": pub_date, "is_translated": True,
            })
    except Exception as e:
        print(f"  [ERR] {name}: {e}")
    return articles[:20]  # 每次最多取20条最新


def scrape_shanghai():
    """上海教育局 - 有JSON API"""
    articles = []
    try:
        resp = requests.get(
            "https://edu.sh.gov.cn/cms-api/api/tool/homepage",
            headers=HEADERS, timeout=10
        )
        data = resp.json()
        for item in data.get("data", {}).get("newsList", []):
            title = item.get("title", "")
            url = "https://edu.sh.gov.cn" + item.get("url", "")
            pub_date = normalize_date(item.get("publishDate"))
            articles.append({
                "title_original": title, "title_zh": title,
                "source_name": "上海市教育局", "source_url": url,
                "module": "policy", "region": "domestic",
                "published_at": pub_date, "is_translated": True,
            })
    except Exception as e:
        print(f"  [ERR] 上海教育局: {e}")
    return articles


def scrape_omep():
    """OMEP - WordPress REST API"""
    articles = []
    try:
        resp = requests.get(
            "https://omep.org/wp-json/wp/v2/posts?per_page=10&orderby=date",
            headers=HEADERS, timeout=10
        )
        for post in resp.json():
            title = post.get("title", {}).get("rendered", "")
            url = post.get("link", "")
            pub_date = normalize_date(post.get("date"))
            excerpt = BeautifulSoup(post.get("excerpt", {}).get("rendered", ""), "html.parser").get_text()
            articles.append({
                "title_original": title, "abstract_original": excerpt or None,
                "source_name": "OMEP", "source_url": url,
                "module": "policy", "region": "international",
                "published_at": pub_date, "is_translated": False,
            })
    except Exception as e:
        print(f"  [ERR] OMEP: {e}")
    return articles


def scrape_brookings():
    """Brookings ECE"""
    articles = []
    try:
        resp = requests.get(
            "https://www.brookings.edu/topic/early-childhood-education/",
            headers=HEADERS, timeout=10
        )
        soup = BeautifulSoup(resp.text, "html.parser")
        for card in soup.select("article, .article-item, .search-result-item"):
            a = card.find("a", href=True)
            if not a:
                continue
            title = a.get_text(strip=True)
            if len(title) < 10:
                continue
            url = a["href"]
            if not url.startswith("http"):
                url = "https://www.brookings.edu" + url
            p = card.find("p")
            abstract = p.get_text(strip=True) if p else None
            articles.append({
                "title_original": title, "abstract_original": abstract,
                "source_name": "Brookings Institution", "source_url": url,
                "module": "research_practice", "region": "international",
                "published_at": None, "is_translated": False,
            })
    except Exception as e:
        print(f"  [ERR] Brookings: {e}")
    return articles[:15]


def scrape_harvard():
    """Harvard Center on the Developing Child"""
    articles = []
    try:
        resp = requests.get(
            "https://developingchild.harvard.edu/resources/",
            headers=HEADERS, timeout=10
        )
        soup = BeautifulSoup(resp.text, "html.parser")
        for card in soup.select(".resource-card, article, .post"):
            a = card.find("a", href=True)
            if not a:
                continue
            title = a.get_text(strip=True)
            if len(title) < 10:
                continue
            url = a["href"]
            if not url.startswith("http"):
                url = "https://developingchild.harvard.edu" + url
            articles.append({
                "title_original": title,
                "source_name": "Harvard Center on the Developing Child",
                "source_url": url,
                "module": "research_practice", "region": "international",
                "published_at": None, "is_translated": False,
            })
    except Exception as e:
        print(f"  [ERR] Harvard: {e}")
    return articles[:15]


def run():
    if not ensure_articles_table():
        return

    print("=== 抓取 国内政策 ===")

    print("  教育部...")
    save_articles(scrape_moe())
    time.sleep(1)

    print("  上海市教育局...")
    save_articles(scrape_shanghai())
    time.sleep(1)

    city_sources = [
        ("北京市教育委员会", "https://jw.beijing.gov.cn/xxgk/zxxxgk/", "https://jw.beijing.gov.cn"),
        ("深圳市教育局",     "https://www.szedu.net/xxgk/zxxxgk/",     "https://www.szedu.net"),
        ("杭州市教育局",     "https://edu.hangzhou.gov.cn/col/col1229284/index.html", "https://edu.hangzhou.gov.cn"),
        ("广州市教育局",     "https://www.gzedu.gov.cn/xxgk/zxxxgk/",  "https://www.gzedu.gov.cn"),
        ("成都市教育局",     "https://edu.chengdu.gov.cn/cdjyxxgk/c131823/list.shtml", "https://edu.chengdu.gov.cn"),
        ("苏州市教育局",     "https://jyj.suzhou.gov.cn/szsjyj/xxgk/list.shtml", "https://jyj.suzhou.gov.cn"),
    ]
    for name, url, base in city_sources:
        print(f"  {name}...")
        save_articles(scrape_city(name, url, base))
        time.sleep(1)

    print("=== 抓取 国际机构 ===")

    print("  OMEP...")
    save_articles(scrape_omep())
    time.sleep(1)

    print("  Brookings...")
    save_articles(scrape_brookings())
    time.sleep(1)

    print("  Harvard Center...")
    save_articles(scrape_harvard())

    print("\n政策抓取完成")


if __name__ == "__main__":
    run()
