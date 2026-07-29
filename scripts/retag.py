"""Reclassify every article not yet using the exclusive primary taxonomy."""

from __future__ import annotations

import json
import os
import time

from openai import OpenAI
from supabase import create_client
from topic_taxonomy import TOPIC_VERSION, taxonomy_prompt, validated_topic

PAGE_SIZE = 500
MAX_ARTICLES = int(os.environ.get("RETAG_MAX_ARTICLES", "0"))
REQUEST_RETRIES = int(os.environ.get("RETAG_REQUEST_RETRIES", "3"))

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url="https://api.deepseek.com",
)


def load_candidates() -> list[dict]:
    candidates: list[dict] = []
    offset = 0
    while True:
        result = (
            supabase.table("articles")
            .select(
                "id,title_original,title_zh,abstract_original,abstract_zh,"
                "topic_version,published_at,fetched_at"
            )
            .order("published_at", desc=True, nullsfirst=False)
            .order("fetched_at", desc=True)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = result.data or []
        candidates.extend(
            article for article in rows
            if article.get("topic_version") != TOPIC_VERSION
        )
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return candidates[:MAX_ARTICLES] if MAX_ARTICLES > 0 else candidates


def tag_article(title: str, abstract: str | None) -> list[str]:
    content = f"标题：{title}"
    if abstract:
        content += f"\n\n摘要：{abstract}"
    prompt = f"""你是学前教育研究分类专家。
{taxonomy_prompt()}

严格输出 JSON，不要有其他内容：
{{"category": "唯一主类别或null", "confidence": 0.0}}

{content}"""
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=160,
        response_format={"type": "json_object"},
    )
    data = json.loads((response.choices[0].message.content or "").strip())
    return validated_topic(data.get("category"), data.get("confidence"))


def tag_with_retries(article: dict) -> list[str]:
    last_error: Exception | None = None
    title = article.get("title_zh") or article.get("title_original") or ""
    abstract = article.get("abstract_zh") or article.get("abstract_original")
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            return tag_article(title, abstract)
        except Exception as error:
            last_error = error
            print(f"    [WARN] 第 {attempt}/{REQUEST_RETRIES} 次分类失败: {error}")
            if attempt < REQUEST_RETRIES:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(str(last_error))


def run() -> None:
    articles = load_candidates()
    if not articles:
        print("所有文献已使用最新单一主类别")
        return

    print(f"开始重新分类 {len(articles)} 篇文献（按发布日期从新到旧）...")
    failed: list[str] = []
    for index, article in enumerate(articles, start=1):
        try:
            topics = tag_with_retries(article)
            (
                supabase.table("articles")
                .update({"topic_tags": topics, "topic_version": TOPIC_VERSION})
                .eq("id", article["id"])
                .execute()
            )
            print(f"  [{index}/{len(articles)}] [OK] {topics or ['未可靠分类']}")
            time.sleep(0.3)
        except Exception as error:
            failed.append(article["id"])
            print(f"  [{index}/{len(articles)}] [ERR] {article['id']}: {error}")

    print(f"重新分类完成：成功 {len(articles) - len(failed)}，失败 {len(failed)}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    run()
