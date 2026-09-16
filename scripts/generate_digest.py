"""Generate the weekly research digest (本周速览) from newly fetched journal articles.

Summarizes the week's research_frontier articles into one plain-language paragraph
(zh + en), then stores it in the `weekly_digests` table for the homepage to display.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import time
from zoneinfo import ZoneInfo

from openai import OpenAI
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

TZ = ZoneInfo("Asia/Shanghai")
MODULE = "research_frontier"
MAX_ARTICLES = int(os.environ.get("DIGEST_MAX_ARTICLES", "40"))
MIN_ARTICLES = int(os.environ.get("DIGEST_MIN_ARTICLES", "3"))
ABSTRACT_CHAR_LIMIT = int(os.environ.get("DIGEST_ABSTRACT_CHAR_LIMIT", "300"))
REQUEST_RETRIES = int(os.environ.get("DIGEST_REQUEST_RETRIES", "3"))


def ensure_digests_table() -> bool:
    try:
        supabase.table("weekly_digests").select("id").limit(1).execute()
        return True
    except Exception as e:
        msg = str(e)
        if "PGRST205" in msg or "weekly_digests" in msg:
            print("[ERR] 请在 Supabase SQL Editor 执行 scripts/migrate_add_weekly_digests.sql")
            return False
        raise


def current_week_window() -> tuple[dt.date, dt.date]:
    today = dt.datetime.now(TZ).date()
    week_end = today - dt.timedelta(days=1)    # 昨天（含）
    week_start = today - dt.timedelta(days=7)  # 7 天前（含）
    return week_start, week_end


def load_week_articles(week_start: dt.date, week_end: dt.date) -> list[dict]:
    start_iso = f"{week_start.isoformat()}T00:00:00+08:00"
    end_iso = f"{week_end.isoformat()}T23:59:59+08:00"

    articles: list[dict] = []
    offset = 0
    page_size = 500
    while True:
        result = (
            supabase.table("articles")
            .select(
                "id,title_original,title_zh,abstract_original,abstract_zh,"
                "source_name,source_url,published_at,fetched_at"
            )
            .eq("module", MODULE)
            .gte("fetched_at", start_iso)
            .lte("fetched_at", end_iso)
            .order("published_at", desc=True, nullsfirst=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = result.data or []
        articles.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    # 最新优先，并限制喂给模型的数量
    articles.sort(key=lambda a: a.get("published_at") or "", reverse=True)
    return articles[:MAX_ARTICLES]


def display_title(a: dict) -> str:
    return (a.get("title_zh") or "").strip() or (a.get("title_original") or "").strip()


def display_abstract(a: dict) -> str:
    abstract = (a.get("abstract_zh") or "").strip() or (a.get("abstract_original") or "").strip()
    if len(abstract) > ABSTRACT_CHAR_LIMIT:
        abstract = abstract[:ABSTRACT_CHAR_LIMIT] + "…"
    return abstract


def build_prompt(articles: list[dict]) -> str:
    lines = []
    for i, a in enumerate(articles, start=1):
        title = display_title(a)
        abstract = display_abstract(a)
        source = (a.get("source_name") or "").strip()
        line = f"{i}. {title}"
        if source:
            line += f"（{source}）"
        if abstract:
            line += f"\n   摘要：{abstract}"
        lines.append(line)
    listing = "\n".join(lines)

    return f"""你是学前教育领域的研究助理。以下是过去一周新发表的学前教育学术论文清单。请把它们综合成一段「本周速览」：

要求：
1. 用通俗易懂的大白话写，像新媒体新闻或文献综述的导语，面向一线幼教工作者、家长和关注教育的普通读者，不要堆砌学术术语。
2. 不是逐篇罗列，而是提炼本周研究的共同主题、热点问题或值得关注的新发现（2-3 个短段落即可，总长 150-250 字）。
3. 如果论文之间有呼应或分歧，可以点出来；没有就不强求。
4. 同时写一份英文版 summary_en（同样通俗，80-150 词）。

输出格式严格如下（JSON，不要有其他内容）：
{{
  "summary_zh": "中文速览",
  "summary_en": "English digest"
}}

论文清单：
{listing}"""


def generate_digest(articles: list[dict]) -> tuple[str, str]:
    prompt = build_prompt(articles)
    last_error: Exception | None = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=2000,
                response_format={"type": "json_object"},
            )
            raw = (resp.choices[0].message.content or "").strip()
            data = json.loads(raw)
            summary_zh = (data.get("summary_zh") or "").strip()
            summary_en = (data.get("summary_en") or "").strip()
            if not summary_zh:
                raise ValueError("模型未返回中文速览")
            return summary_zh, summary_en
        except Exception as error:
            last_error = error
            print(f"    [WARN] 第 {attempt}/{REQUEST_RETRIES} 次生成失败: {error}")
            if attempt < REQUEST_RETRIES:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(str(last_error))


def run() -> None:
    if not ensure_digests_table():
        return

    week_start, week_end = current_week_window()
    print(f"本周窗口：{week_start.isoformat()} ~ {week_end.isoformat()}")

    articles = load_week_articles(week_start, week_end)
    if not articles:
        print("本周没有新增期刊论文，跳过")
        return
    if len(articles) < MIN_ARTICLES:
        print(f"本周仅 {len(articles)} 篇，低于阈值 {MIN_ARTICLES}，跳过")
        return

    print(f"共 {len(articles)} 篇论文，开始生成速览…")
    summary_zh, summary_en = generate_digest(articles)

    article_ids = [a["id"] for a in articles]
    payload = {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "summary_zh": summary_zh,
        "summary_en": summary_en,
        "article_ids": article_ids,
        "article_count": len(article_ids),
    }

    try:
        supabase.table("weekly_digests").upsert(payload, on_conflict="week_start").execute()
    except Exception as error:
        print(f"[ERR] 写入 weekly_digests 失败: {error}")
        raise SystemExit(1)

    print(f"[OK] 速览已写入（{len(article_ids)} 篇论文）")
    print("中文：")
    print(summary_zh)
    print("英文：")
    print(summary_en)


if __name__ == "__main__":
    run()
