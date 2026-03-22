"""
国内核心期刊抓取脚本（替代方案）
由于知网反爬虫严格，使用以下策略：
1. 期刊官网RSS/公开页面
2. 万方数据公开接口
3. 学术搜索引擎（如百度学术）
"""

import os
import sys
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from supabase import create_client

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# 北大核心期刊配置
CORE_JOURNALS = [
    {
        "name": "学前教育研究",
        "source": "cnki",
        "keywords": ["学前教育", "幼儿", "早期教育"],
    },
    {
        "name": "电化教育研究",
        "source": "cnki",
        "keywords": ["教育技术", "在线学习", "智慧教育"],
    },
    {
        "name": "中国电化教育",
        "source": "cnki",
        "keywords": ["教育信息化", "数字化学习"],
    },
]


def search_baidu_scholar(journal_name, keywords, max_results=10):
    """
    使用百度学术搜索期刊文章
    百度学术的公开数据相对容易获取
    """
    articles = []
    try:
        # 构建搜索查询
        query = f"{journal_name} {' '.join(keywords[:2])}"
        search_url = "https://xueshu.baidu.com/s"
        params = {
            "wd": query,
            "rsv_bp": "0",
            "tn": "SE_baiduxueshu_c1gjeupa",
            "ie": "utf-8",
            "rsv_spt": "3",
        }

        resp = requests.get(search_url, params=params, headers=HEADERS, timeout=15)
        resp.encoding = 'utf-8'
        soup = BeautifulSoup(resp.text, 'html.parser')

        # 解析搜索结果
        for item in soup.select('.result')[:max_results]:
            try:
                # 标题
                title_elem = item.select_one('h3 a, .t a')
                if not title_elem:
                    continue
                title = title_elem.get_text(strip=True)

                # 链接
                link = title_elem.get('href', '')

                # 作者
                author_elem = item.select_one('.author_text, .c_font')
                authors = []
                if author_elem:
                    author_text = author_elem.get_text(strip=True)
                    authors = [a.strip() for a in re.split(r'[,，;；]', author_text) if a.strip()][:5]

                # 摘要
                abstract_elem = item.select_one('.abstract, .c_abstract')
                abstract = abstract_elem.get_text(strip=True) if abstract_elem else None

                # 来源和日期
                source_elem = item.select_one('.source, .c_color')
                pub_date = None
                if source_elem:
                    source_text = source_elem.get_text()
                    date_match = re.search(r'(\d{4})', source_text)
                    if date_match:
                        pub_date = f"{date_match.group(1)}-01-01"

                articles.append({
                    "title_original": title,
                    "title_zh": title,
                    "abstract_original": abstract,
                    "abstract_zh": abstract,
                    "authors": authors,
                    "source_name": journal_name,
                    "source_url": link or "https://xueshu.baidu.com",
                    "doi": None,
                    "module": "research_frontier",
                    "region": "domestic",
                    "published_at": pub_date,
                    "is_translated": True,
                })
            except Exception as e:
                continue

    except Exception as e:
        print(f"  [ERR] 百度学术搜索失败: {e}")

    return articles


def save_articles(articles):
    """保存文章到数据库，去重"""
    if not articles:
        return 0

    saved = 0
    for article in articles:
        try:
            # 检查是否已存在
            existing = supabase.table("articles") \
                .select("id") \
                .eq("title_original", article["title_original"]) \
                .execute()

            if existing.data:
                continue

            # 插入新文章
            article["fetched_at"] = datetime.now().isoformat()
            supabase.table("articles").insert(article).execute()
            saved += 1
        except Exception as e:
            continue

    return saved


def run():
    print("=== 抓取国内核心期刊 ===")
    print("使用百度学术作为数据源")
    print()

    total_saved = 0
    for journal in CORE_JOURNALS:
        print(f"  {journal['name']}...")
        articles = search_baidu_scholar(
            journal['name'],
            journal['keywords'],
            max_results=15
        )
        saved = save_articles(articles)
        if saved > 0:
            print(f"    [OK] 保存 {saved} 条")
        total_saved += saved
        time.sleep(2)  # 避免请求过快

    print(f"\n完成！共保存 {total_saved} 篇文章")
    print("\n提示：")
    print("- 百度学术数据可能不完整，建议定期运行")
    print("- 如需更完整的数据，建议使用机构知网账号或API")


if __name__ == "__main__":
    run()
