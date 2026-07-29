"""Translate every incomplete international article, newest first."""

from __future__ import annotations

import json
import os
import re
import time

from openai import OpenAI
from supabase import create_client
from topic_taxonomy import TOPIC_VERSION, taxonomy_prompt, validated_topic

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

PAGE_SIZE = 500
MAX_ARTICLES = int(os.environ.get("TRANSLATION_MAX_ARTICLES", "0"))
REQUEST_RETRIES = int(os.environ.get("TRANSLATION_REQUEST_RETRIES", "3"))

CJK_PATTERN = re.compile(r"[\u3400-\u9fff]")
LATIN_PATTERN = re.compile(r"[A-Za-z]")


def contains_chinese(value: str | None) -> bool:
    return bool(value and CJK_PATTERN.search(value))


def is_chinese_translation(value: str | None) -> bool:
    if not value:
        return False
    chinese_count = len(CJK_PATTERN.findall(value))
    latin_count = len(LATIN_PATTERN.findall(value))
    if chinese_count < 2:
        return False
    return chinese_count / max(chinese_count + latin_count, 1) >= 0.20


def translation_is_complete(article: dict) -> bool:
    if not article.get("is_translated") or not is_chinese_translation(article.get("title_zh")):
        return False
    abstract = (article.get("abstract_original") or "").strip()
    return not abstract or is_chinese_translation(article.get("abstract_zh"))


def ensure_articles_table() -> bool:
    try:
        supabase.table("articles").select("id").limit(1).execute()
        return True
    except Exception as e:
        msg = str(e)
        if "PGRST205" in msg or "public.articles" in msg:
            print("[ERR] 请先执行 scripts/init_db.sql 和 scripts/migrate_add_citations.sql")
            return False
        raise


def load_translation_candidates() -> list[dict]:
    candidates: list[dict] = []
    offset = 0

    while True:
        result = (
            supabase.table("articles")
            .select(
                "id,title_original,title_zh,abstract_original,abstract_zh,"
                "is_translated,published_at,fetched_at"
            )
            .eq("region", "international")
            .order("published_at", desc=True, nullsfirst=False)
            .order("fetched_at", desc=True)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = result.data or []
        candidates.extend(article for article in rows if not translation_is_complete(article))
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    if MAX_ARTICLES > 0:
        return candidates[:MAX_ARTICLES]
    return candidates


def translate_and_tag(title: str, abstract: str | None) -> tuple[str, str | None, list[str]]:
    """Translate title/abstract and return validated topic labels."""
    content = f"标题：{title}"
    if abstract:
        content += f"\n\n摘要：{abstract}"

    prompt = f"""你是学前教育领域的学术翻译。请完成以下任务：

1. 将标题和摘要完整翻译成简体中文，保持学术准确性，不得保留未翻译的英文句子
2. 根据中心研究问题判断唯一的主类别并给出置信度。

{taxonomy_prompt()}

输出格式严格如下（JSON，不要有其他内容）：
{{
  "title_zh": "完整中文标题",
  "abstract_zh": "完整中文摘要（原文无摘要则为null）",
  "category": "唯一主类别，无法可靠判断时为null",
  "confidence": 0.0
}}

{content}"""

    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=4000,
        response_format={"type": "json_object"},
    )
    raw = (resp.choices[0].message.content or "").strip()
    data = json.loads(raw)

    title_zh = (data.get("title_zh") or "").strip()
    abstract_zh = (data.get("abstract_zh") or "").strip() or None
    topics = validated_topic(data.get("category"), data.get("confidence"))

    if not is_chinese_translation(title_zh):
        raise ValueError("模型未返回有效中文标题")
    if abstract and not is_chinese_translation(abstract_zh):
        raise ValueError("模型未返回有效中文摘要")

    return title_zh, abstract_zh, topics


def translate_article(article: dict) -> tuple[str, str | None, list[str]]:
    last_error: Exception | None = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            return translate_and_tag(
                article["title_original"],
                article.get("abstract_original"),
            )
        except Exception as error:
            last_error = error
            print(f"    [WARN] 第 {attempt}/{REQUEST_RETRIES} 次翻译失败: {error}")
            if attempt < REQUEST_RETRIES:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(str(last_error))


def run() -> None:
    if not ensure_articles_table():
        return

    articles = load_translation_candidates()
    if not articles:
        print("没有需要翻译的文章")
        return

    print(f"开始翻译 + 分类 {len(articles)} 篇文章（按发布日期从新到旧）...")
    translated = 0
    failed: list[str] = []

    for index, article in enumerate(articles, start=1):
        try:
            title_zh, abstract_zh, topics = translate_article(article)
            (
                supabase.table("articles")
                .update({
                    "title_zh": title_zh,
                    "abstract_zh": abstract_zh,
                    "topic_tags": topics,
                    "topic_version": TOPIC_VERSION,
                    "is_translated": True,
                })
                .eq("id", article["id"])
                .execute()
            )
            translated += 1
            print(f"  [{index}/{len(articles)}] [OK] {article['title_original'][:52]}…")
            time.sleep(0.3)
        except Exception as error:
            failed.append(article["id"])
            print(f"  [{index}/{len(articles)}] [ERR] {article['id']}: {error}")

    print(f"翻译完成：成功 {translated}，失败 {len(failed)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    run()
