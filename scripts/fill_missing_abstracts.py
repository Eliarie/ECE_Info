"""
对缺摘要的文章，通过 CrossRef API 获取真实摘要，再用 DeepSeek 翻译。
只使用官方来源的摘要，不生成、不编造。
用法：
  SUPABASE_URL=... SUPABASE_KEY=... DEEPSEEK_API_KEY=... python scripts/fill_missing_abstracts.py
"""

import os
import re
import time
import requests
from openai import OpenAI
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]
OPENALEX_EMAIL = os.environ.get("OPENALEX_EMAIL", "")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

BATCH_SIZE = 50


def fetch_abstract_from_crossref(doi: str) -> str | None:
    """从 CrossRef 获取真实摘要，失败返回 None"""
    if not doi:
        return None
    clean_doi = doi.replace("https://doi.org/", "").strip()
    try:
        resp = requests.get(
            f"https://api.crossref.org/works/{clean_doi}",
            headers={"User-Agent": f"fill_missing_abstracts/1.0 (mailto:{OPENALEX_EMAIL})"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        data = resp.json().get("message", {})
        abstract = data.get("abstract", "")
        if not abstract:
            return None
        # 去掉 CrossRef 返回的 JATS XML 标签（如 <jats:p>）
        abstract = re.sub(r"<[^>]+>", " ", abstract).strip()
        abstract = re.sub(r"\s+", " ", abstract)
        return abstract or None
    except Exception as e:
        print(f"  [ERR] CrossRef 请求失败 {doi}: {e}")
        return None


def fetch_abstract_from_openalex(doi: str) -> str | None:
    """从 OpenAlex 获取摘要（倒排索引格式），失败返回 None"""
    if not doi:
        return None
    clean_doi = doi.replace("https://doi.org/", "").strip()
    params = {"filter": f"doi:{clean_doi}", "select": "abstract_inverted_index"}
    if OPENALEX_EMAIL:
        params["mailto"] = OPENALEX_EMAIL
    try:
        resp = requests.get("https://api.openalex.org/works", params=params, timeout=10)
        results = resp.json().get("results", [])
        if not results:
            return None
        inverted = results[0].get("abstract_inverted_index")
        if not inverted:
            return None
        words: dict[int, str] = {}
        for word, positions in inverted.items():
            for pos in positions:
                words[pos] = word
        return " ".join(words[i] for i in sorted(words)) or None
    except Exception as e:
        print(f"  [ERR] OpenAlex 请求失败 {doi}: {e}")
        return None


def translate_abstract(title: str, abstract: str) -> str | None:
    """用 DeepSeek 翻译摘要，失败返回 None"""
    prompt = f"""请将以下学术论文摘要翻译成中文，保持学术准确性，只输出译文，不要其他内容。

标题：{title}
摘要：{abstract}"""
    try:
        resp = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=600,
        )
        return resp.choices[0].message.content.strip() or None
    except Exception as e:
        print(f"  [ERR] DeepSeek 翻译失败: {e}")
        return None


def run():
    result = supabase.table("articles") \
        .select("id, title_original, doi") \
        .is_("abstract_original", "null") \
        .is_("abstract_zh", "null") \
        .eq("region", "international") \
        .not_.is_("doi", "null") \
        .limit(BATCH_SIZE) \
        .execute()

    articles = result.data
    if not articles:
        print("没有缺摘要的文章（或均无 DOI）")
        return

    print(f"找到 {len(articles)} 篇缺摘要文章，尝试从 CrossRef 获取...")

    found = 0
    for i, article in enumerate(articles):
        doi = article.get("doi", "")
        abstract_original = fetch_abstract_from_crossref(doi)

        if not abstract_original:
            abstract_original = fetch_abstract_from_openalex(doi)

        if not abstract_original:
            print(f"  [{i+1}/{len(articles)}] [无摘要] {article['title_original'][:50]}…")
            time.sleep(0.3)
            continue

        abstract_zh = translate_abstract(article["title_original"], abstract_original)

        supabase.table("articles").update({
            "abstract_original": abstract_original,
            "abstract_zh": abstract_zh,
        }).eq("id", article["id"]).execute()

        found += 1
        print(f"  [{i+1}/{len(articles)}] [OK] {article['title_original'][:50]}…")
        time.sleep(0.5)

    print(f"\n完成：{found}/{len(articles)} 篇补填成功，其余原文无公开摘要")


if __name__ == "__main__":
    run()
