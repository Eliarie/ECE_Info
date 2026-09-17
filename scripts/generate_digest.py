"""Generate the weekly research digest (本周速览) from newly fetched journal articles.

Produces:
- an overview paragraph (zh+en) with inline [text](index) references to articles,
- per-article highlights (result + core, zh+en).

Stores everything in `weekly_digests` for the homepage to display.
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
MODULES = ["research_frontier", "research_practice", "policy"]
MODULE_LABEL = {"research_frontier": "论文", "research_practice": "实践", "policy": "政策"}
MAX_ARTICLES = int(os.environ.get("DIGEST_MAX_ARTICLES", "40"))
MIN_ARTICLES = int(os.environ.get("DIGEST_MIN_ARTICLES", "3"))
ABSTRACT_CHAR_LIMIT = int(os.environ.get("DIGEST_ABSTRACT_CHAR_LIMIT", "260"))
HIGHLIGHT_BATCH = int(os.environ.get("DIGEST_HIGHLIGHT_BATCH", "10"))
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
    week_end = today - dt.timedelta(days=1)
    week_start = today - dt.timedelta(days=7)
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
                "source_name,source_url,module,published_at,fetched_at"
            )
            .in_("module", MODULES)
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

    articles.sort(key=lambda a: a.get("published_at") or "", reverse=True)
    return articles[:MAX_ARTICLES]


def display_title(a: dict) -> str:
    return (a.get("title_zh") or "").strip() or (a.get("title_original") or "").strip()


def display_abstract(a: dict) -> str:
    abstract = (a.get("abstract_zh") or "").strip() or (a.get("abstract_original") or "").strip()
    if len(abstract) > ABSTRACT_CHAR_LIMIT:
        abstract = abstract[:ABSTRACT_CHAR_LIMIT] + "…"
    return abstract


def build_article_listing(articles: list[dict]) -> str:
    lines = []
    for i, a in enumerate(articles, start=1):
        title = display_title(a)
        abstract = display_abstract(a)
        source = (a.get("source_name") or "").strip()
        kind = MODULE_LABEL.get(a.get("module") or "", "")
        line = f"{i}. {title}"
        if source or kind:
            line += f"（{source}·{kind}）" if source and kind else f"（{source or kind}）"
        if abstract:
            line += f"\n   摘要：{abstract}"
        lines.append(line)
    return "\n".join(lines)


def _chat_json(prompt: str, max_tokens: int = 2000, temperature: float = 0.4) -> dict:
    last_error: Exception | None = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            resp = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            raw = (resp.choices[0].message.content or "").strip()
            return json.loads(raw)
        except Exception as error:
            last_error = error
            print(f"    [WARN] 第 {attempt}/{REQUEST_RETRIES} 次失败: {error}")
            if attempt < REQUEST_RETRIES:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(str(last_error))


def generate_overview(articles: list[dict]) -> tuple[str, str]:
    listing = build_article_listing(articles)
    prompt = f"""你是学前教育领域的研究助理。以下是本周新发表的论文清单（每篇有编号、标题、摘要）。

请写一段「本周概览」：
1. 通俗大白话（面向一线幼教工作者、家长和普通读者），不要堆学术术语。
2. 250-350 字，2-4 个自然段。
3. 当你提到某篇论文的具体观点或发现时，用 [短语](编号) 形式内联标注，编号必须是下面清单中的序号（1-{len(articles)}），至少标注 6 处，让读者点进去看原文。
4. 不要逐篇罗列，提炼共同主题、热点和值得关注的发现；有呼应或分歧可以点出来。
5. 同时写一份英文版 overview_en（150-200 词，同样用 [phrase](number) 标注）。

输出严格为 JSON（不要其他内容）：
{{"overview_zh": "...", "overview_en": "..."}}

论文清单：
{listing}"""
    data = _chat_json(prompt, max_tokens=2400, temperature=0.5)
    zh = (data.get("overview_zh") or "").strip()
    en = (data.get("overview_en") or "").strip()
    if not zh:
        raise ValueError("模型未返回中文概览")
    return zh, en


def generate_highlights(articles: list[dict]) -> list[dict]:
    highlights: list[dict] = []
    for start in range(0, len(articles), HIGHLIGHT_BATCH):
        chunk = articles[start:start + HIGHLIGHT_BATCH]
        listing = build_article_listing(chunk)
        prompt = f"""以下是若干篇学前教育论文。请为每篇各写两句话（中文 + 英文）：
- result：一句话说明该研究的核心结果/发现
- core：一句话说明这篇论文的中心内容/在研究什么问题

要求通俗、准确、不照抄摘要。

输出 JSON 对象，含 items 数组，顺序与输入一致，不要输出其他内容：
{{"items":[{{"result_zh": "...", "core_zh": "...", "result_en": "...", "core_en": "..."}}]}}

论文：
{listing}"""
        data = _chat_json(prompt, max_tokens=3000, temperature=0.3)
        items = data.get("items") if isinstance(data, dict) else data
        if not isinstance(items, list):
            raise ValueError("模型未返回 highlights items 数组")
        for idx, item in enumerate(items):
            if idx >= len(chunk):
                continue
            article = chunk[idx]
            highlights.append({
                "article_id": article["id"],
                "result_zh": (item.get("result_zh") or "").strip(),
                "core_zh": (item.get("core_zh") or "").strip(),
                "result_en": (item.get("result_en") or "").strip(),
                "core_en": (item.get("core_en") or "").strip(),
            })
        print(f"  [OK] highlights {start + 1}-{start + len(chunk)}/{len(articles)}")
        time.sleep(0.3)

    # 无摘要的论文可能被模型返回空，用标题单独补写
    empty_idx = [i for i, h in enumerate(highlights) if not (h["result_zh"] and h["core_zh"])]
    if empty_idx:
        print(f"  [WARN] {len(empty_idx)} 条分点为空，用标题重试…")
        repaired = _generate_highlights_title_only([articles[i] for i in empty_idx])
        for pos, idx in enumerate(empty_idx):
            if pos < len(repaired):
                highlights[idx] = repaired[pos]
    return highlights


def _generate_highlights_title_only(articles: list[dict]) -> list[dict]:
    lines = []
    for a in articles:
        title = display_title(a)
        source = (a.get("source_name") or "").strip()
        line = f"- {title}"
        if source:
            line += f"（{source}）"
        lines.append(line)
    listing = "\n".join(lines)

    prompt = f"""以下论文仅有标题（无摘要）。请根据标题为每篇各写两句话（中文 + 英文）：
- result：一句话说明该研究可能的发现/结论；若标题无法判断结果，写该研究关注的焦点问题
- core：一句话说明这篇论文的中心内容/在研究什么问题

输出 JSON 对象，含 items 数组，顺序与输入一致，不要输出其他内容：
{{"items":[{{"result_zh": "...", "core_zh": "...", "result_en": "...", "core_en": "..."}}]}}

论文：
{listing}"""
    data = _chat_json(prompt, max_tokens=2000, temperature=0.3)
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for idx, item in enumerate(items):
        if idx >= len(articles):
            continue
        article = articles[idx]
        out.append({
            "article_id": article["id"],
            "result_zh": (item.get("result_zh") or "").strip(),
            "core_zh": (item.get("core_zh") or "").strip(),
            "result_en": (item.get("result_en") or "").strip(),
            "core_en": (item.get("core_en") or "").strip(),
        })
    return out


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

    print(f"共 {len(articles)} 篇论文")
    print("生成概览…")
    overview_zh, overview_en = generate_overview(articles)
    print("生成分点总结…")
    highlights = generate_highlights(articles)

    article_ids = [a["id"] for a in articles]
    payload = {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "summary_zh": overview_zh,
        "summary_en": overview_en,
        "highlights": highlights,
        "article_ids": article_ids,
        "article_count": len(article_ids),
    }

    try:
        supabase.table("weekly_digests").upsert(payload, on_conflict="week_start").execute()
    except Exception as error:
        print(f"[ERR] 写入 weekly_digests 失败: {error}")
        raise SystemExit(1)

    print(f"[OK] 已写入（{len(article_ids)} 篇，{len(highlights)} 条分点）")
    print("概览：")
    print(overview_zh)


if __name__ == "__main__":
    run()
