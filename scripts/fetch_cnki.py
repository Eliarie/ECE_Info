"""
知网期刊抓取脚本
抓取国内学前教育期刊的最新文章（标题、作者、摘要等公开信息）
"""

import os
import sys
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from supabase import create_client

# 修复 Windows 控制台编码问题
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

# 国内学前教育期刊列表
JOURNALS = [
    {"name": "学前教育研究", "issn": "1007-8169"},
    {"name": "幼儿教育", "issn": "1004-4604"},
    {"name": "早期教育", "issn": "1005-6017"},
    {"name": "学前教育", "issn": "1000-4130"},
    {"name": "中国特殊教育", "issn": "1007-3728"},
]


def normalize_date(date_str):
    """将日期字符串转换为 YYYY-MM-DD 格式"""
    if not date_str:
        return None
    # 匹配 YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD 等格式
    match = re.search(r'(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})', date_str)
    if match:
        year, month, day = match.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    return None


def scrape_cnki_journal(journal_name, issn):
    """
    尝试从知网抓取期刊文章的公开信息
    注意：知网有反爬虫机制，这个方法可能不稳定
    """
    articles = []
    try:
        # 构建知网搜索URL（搜索最近一年的文章）
        search_url = f"https://kns.cnki.net/kns8/defaultresult/index"
        params = {
            "kw": journal_name,
            "korder": "SU",  # 按来源排序
        }

        resp = requests.get(search_url, params=params, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.text, 'html.parser')

        # 尝试解析搜索结果（知网的HTML结构可能会变化）
        # 这里只是一个示例，实际可能需要调整选择器
        for item in soup.select('.result-table-list tbody tr')[:20]:
            try:
                title_elem = item.select_one('.name a, .fz14')
                if not title_elem:
                    continue

                title = title_elem.get_text(strip=True)
                if len(title) < 5:
                    continue

                # 尝试获取链接
                link = title_elem.get('href', '')
                if link and not link.startswith('http'):
                    link = 'https://kns.cnki.net' + link

                # 尝试获取作者
                author_elem = item.select_one('.author')
                authors = []
                if author_elem:
                    author_text = author_elem.get_text(strip=True)
                    authors = [a.strip() for a in author_text.split(';') if a.strip()]

                # 尝试获取日期
                date_elem = item.select_one('.date')
                pub_date = None
                if date_elem:
                    pub_date = normalize_date(date_elem.get_text(strip=True))

                articles.append({
                    "title_original": title,
                    "title_zh": title,  # 国内期刊，中文标题
                    "abstract_original": None,  # 知网搜索结果通常不显示摘要
                    "abstract_zh": None,
                    "authors": authors,
                    "source_name": journal_name,
                    "source_url": link or f"https://kns.cnki.net",
                    "doi": None,
                    "module": "research_frontier",
                    "region": "domestic",
                    "published_at": pub_date,
                    "is_translated": True,  # 国内期刊标记为已翻译
                })
            except Exception as e:
                continue

    except Exception as e:
        print(f"  [ERR] {journal_name}: {e}")

    return articles


def save_articles(articles):
    """保存文章到数据库，去重"""
    if not articles:
        return

    saved = 0
    for article in articles:
        try:
            # 检查是否已存在（根据标题和来源去重）
            existing = supabase.table("articles") \
                .select("id") \
                .eq("title_original", article["title_original"]) \
                .eq("source_name", article["source_name"]) \
                .execute()

            if existing.data:
                continue

            # 插入新文章
            article["fetched_at"] = datetime.now().isoformat()
            supabase.table("articles").insert(article).execute()
            saved += 1
        except Exception as e:
            print(f"  [ERR] 保存失败: {e}")

    if saved > 0:
        print(f"  [OK] 保存 {saved} 条")


def run():
    print("=== 抓取知网期刊 ===")
    print("注意：知网有反爬虫机制，抓取可能不稳定")
    print()

    for journal in JOURNALS:
        print(f"  {journal['name']}...")
        articles = scrape_cnki_journal(journal['name'], journal['issn'])
        save_articles(articles)
        time.sleep(3)  # 避免请求过快

    print("\n知网期刊抓取完成")
    print("提示：如果抓取失败，可能需要使用其他方法（如RSS订阅或API）")


if __name__ == "__main__":
    run()
