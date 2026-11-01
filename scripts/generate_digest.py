"""Generate the weekly research digest (本周速览) from newly fetched journal articles.

Produces:
- an overview paragraph (zh+en) with inline [text](index) references to articles,
- per-article highlights (result + core, zh+en).

Stores everything in `weekly_digests` for the homepage to display.

Then writes a monthly interest overview (兴趣速览) for every subscribed interest
whose latest overview is a month old, into `user_interest_digests`, so each
interest's monthly archive has no gaps even if the subscriber never opened the site.
An overview covers the latest INTEREST_WINDOW_WEEKS weekly digests and is keyed by
the newest week's week_start. Links are stored as [text](article uuid).

Usage:
  python scripts/generate_digest.py                    # weekly digest + interest overviews
  python scripts/generate_digest.py --dry-run          # print the plan, no model calls, no writes
  python scripts/generate_digest.py --interests-only   # only fill due interest overviews, window ending at the latest digest
  python scripts/generate_digest.py --interests-only --week-start 2026-10-12
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
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
INTEREST_JOB_TOKEN = os.environ.get("INTEREST_DIGEST_JOB_TOKEN", "").strip()
INTEREST_MAX = int(os.environ.get("INTEREST_DIGEST_MAX_INTERESTS", "100"))
# 兴趣速览每月一份：最近这么多期周报里都没有存档就该生成，内容也概括这么多期（与首页 INTEREST_MONTH_WEEKS 一致）
INTEREST_WINDOW_WEEKS = 4
# 仓库是公开的，Actions 日志人人可见：CI 里不打印兴趣原文、同步码和数据库报错详情
IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"


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


def load_digest_row(week_start: str | None) -> dict | None:
    query = supabase.table("weekly_digests").select("week_start,week_end,article_ids")
    if week_start:
        query = query.eq("week_start", week_start)
    else:
        query = query.order("week_start", desc=True)
    rows = query.limit(1).execute().data or []
    return rows[0] if rows else None


def load_articles_in_order(ids: list[str]) -> list[dict | None]:
    """按 article_ids 的顺序取回文章；已被删掉的位置留 None，保证编号不错位。"""
    by_id: dict[str, dict] = {}
    for start in range(0, len(ids), 100):
        rows = (
            supabase.table("articles")
            .select("id,title_original,title_zh,abstract_original,abstract_zh,source_name")
            .in_("id", ids[start:start + 100])
            .execute()
        ).data or []
        by_id.update({row["id"]: row for row in rows})
    return [by_id.get(article_id) for article_id in ids]


def build_interest_listing(articles: list[dict]) -> str:
    # 与 web/src/app/api/generate/route.ts 一致：条目多时缩短摘要，控制提示词长度
    abstract_limit = max(80, min(260, 20000 // max(1, len(articles))))
    lines = []
    for i, a in enumerate(articles, start=1):
        title = a.get("title_zh") or a.get("title_original") or ""
        abstract = (a.get("abstract_zh") or a.get("abstract_original") or "")[:abstract_limit]
        source = a.get("source_name") or ""
        line = f"{i}. {title}"
        if source:
            line += f"（{source}）"
        if abstract:
            line += f"\n   摘要：{abstract}"
        lines.append(line)
    return "\n".join(lines)


def _format_day(iso: str) -> str:
    _, month, day = (int(part) for part in iso.split("-"))
    return f"{month}月{day}日"


def _links_to_ids(text: str, articles: list[dict]) -> str:
    # 编号只在这份清单里有意义，存下来之前换成文章 id，首页不必再知道当时的清单
    def replace(match: re.Match) -> str:
        num = int(match.group(2))
        if 1 <= num <= len(articles):
            return f"[{match.group(1)}]({articles[num - 1]['id']})"
        return match.group(1)

    return re.sub(r"\[([^\]]+)\]\((\d+)\)", replace, text.strip())


def generate_interest_overview(
    articles: list[dict], interest: str, period: str, week_count: int
) -> tuple[str, str]:
    # prompt 与 route.ts 的 generateInterestOverview 保持一致，改一边要同步另一边
    listing = build_interest_listing(articles)
    single = week_count == 1
    length = "200-300 字，2-3 段" if single else "300-450 字，3-4 段，把相关内容归纳成几条主线，不要逐条罗列"
    en_length = "100-160" if single else "150-230"
    prompt = f"""你是学前教育领域的研究助理。以下是{period}（共 {week_count} 期周报）收录的内容（论文/实践/政策）。用户感兴趣的主题是：「{interest}」。

请写一段「兴趣概览」：
1. 只聚焦与「{interest}」相关的内容，忽略无关项；如果相关内容很少，如实说明「这段时间与「{interest}」直接相关的内容较少」。
2. 通俗大白话（面向一线幼教工作者、家长和普通读者），{length}。
3. 提到具体条目时用 [短语](编号) 内联标注，编号对应上面清单的序号。
4. 同时写一份英文版 overview_en（{en_length} 词）。

输出严格为 JSON（不要其他内容）：
{{"overview_zh":"...","overview_en":"..."}}

内容清单：
{listing}"""
    data = _chat_json(prompt, max_tokens=2400, temperature=0.5)
    zh = _links_to_ids(data.get("overview_zh") or "", articles)
    en = _links_to_ids(data.get("overview_en") or "", articles)
    if not zh:
        raise ValueError("模型未返回中文概览")
    return zh, en


def load_interest_window(week_start: str) -> list[dict]:
    """截至 week_start（含）最近 INTEREST_WINDOW_WEEKS 期周报，新的在前。"""
    return (
        supabase.table("weekly_digests")
        .select("week_start,week_end,article_ids")
        .lte("week_start", week_start)
        .order("week_start", desc=True)
        .limit(INTEREST_WINDOW_WEEKS)
        .execute()
    ).data or []


def _safe_error(error: Exception) -> str:
    # PostgREST 的 details 可能带整行数据（同步码、兴趣原文），公开日志里只留错误码和消息
    code = getattr(error, "code", None)
    message = getattr(error, "message", None)
    if IN_CI and (code or message):
        return f"{code or ''} {message or ''}".strip()
    return str(error)


def generate_interest_digests(week_start: str, dry_run: bool) -> None:
    """给满一个月没有新速览的订阅补上一份，概括截至 week_start 的近一个月。

    同一兴趣文本只调用一次模型，再写给所有到期的同步码。
    失败只影响该兴趣（打印后继续），不让整个任务失败；用户打开首页时前端仍会补生成。
    """
    print(f"\n兴趣速览（截至 {week_start} 这一期的近一个月）…")
    if not INTEREST_JOB_TOKEN:
        print("  [SKIP] 未配置 INTEREST_DIGEST_JOB_TOKEN，跳过（启用步骤见 RUN_THIS_SQL.md ①-3）")
        return

    window = load_interest_window(week_start)
    if dry_run and (not window or window[0]["week_start"] != week_start):
        print("  [DRY] 这一期还没写入，下面的范围只含已有的几期")
    ids = list(dict.fromkeys(i for row in window for i in (row.get("article_ids") or [])))
    articles = [a for a in load_articles_in_order(ids) if a]
    if not articles:
        print("  [SKIP] 这段时间没有可用条目")
        return
    # 首页和这里都以周报的 week_start 作存档键，所以「最近几期里都没有存档」= 上一份已满一个月
    recent_weeks = list(dict.fromkeys([week_start] + [row["week_start"] for row in window]))[:INTEREST_WINDOW_WEEKS]
    period = f"{_format_day(window[-1]['week_start'])}至{_format_day(window[0]['week_end'])}" if window else week_start
    print(f"  范围：{period}，{len(window)} 期周报、{len(articles)} 条")

    try:
        per_week = [
            supabase.rpc(
                "list_interest_digest_targets",
                {"p_job_token": INTEREST_JOB_TOKEN, "p_week_start": week},
            ).execute().data or []
            for week in recent_weeks
        ]
    except Exception as error:
        hint = "（请先执行 RUN_THIS_SQL.md ①-2、①-3）" if "PGRST202" in str(error) else ""
        print(f"  [WARN] 读取兴趣订阅失败{hint}: {_safe_error(error)}")
        if IN_CI:
            print("::warning::兴趣速览未执行：读取订阅失败")
        return

    # 某个订阅在每一期都待生成，才说明它最近一个月都没有速览
    targets = []
    for target in per_week[0]:
        due = list(target.get("pending_device_ids") or [])
        for rows in per_week[1:]:
            pending = next((set(t.get("pending_device_ids") or []) for t in rows if t["interest"] == target["interest"]), set())
            due = [device for device in due if device in pending]
        total = len(target.get("pending_device_ids") or []) + int(target.get("done_count") or 0)
        targets.append({"interest": target["interest"], "pending_device_ids": due, "done_count": total - len(due)})
    targets.sort(key=lambda t: (-len(t["pending_device_ids"]), t["interest"]))

    pending = [t for t in targets if t.get("pending_device_ids")]
    pending_pairs = sum(len(t["pending_device_ids"]) for t in pending)
    done_pairs = sum(int(t.get("done_count") or 0) for t in targets)
    print(
        f"  订阅中的兴趣 {len(targets)} 个：待生成 {len(pending)} 个兴趣（{pending_pairs} 个订阅），"
        f"近一个月已有速览的订阅 {done_pairs} 个"
    )
    if len(pending) > INTEREST_MAX:
        print(f"  [WARN] 待生成兴趣超过上限 {INTEREST_MAX}，本次只处理订阅数最多的前 {INTEREST_MAX} 个")
        pending = pending[:INTEREST_MAX]

    generated = written_total = failed = 0
    for n, target in enumerate(pending, start=1):
        interest = target["interest"]
        device_ids = target["pending_device_ids"]
        label = f"#{n}" if IN_CI else f"#{n}「{interest}」"
        if dry_run:
            print(
                f"  [DRY] {label} → 将生成 1 次并写给 {len(device_ids)} 个订阅"
                f"（近一个月已有 {int(target.get('done_count') or 0)} 个）"
            )
            continue
        try:
            overview_zh, overview_en = generate_interest_overview(articles, interest, period, len(window))
            written = supabase.rpc(
                "save_interest_digest_for_devices",
                {
                    "p_job_token": INTEREST_JOB_TOKEN,
                    "p_interest": interest,
                    "p_week_start": week_start,
                    "p_overview_zh": overview_zh,
                    "p_overview_en": overview_en,
                    "p_device_ids": device_ids,
                },
            ).execute().data or 0
            generated += 1
            written_total += written
            print(f"  [OK] {label} → 写入 {written}/{len(device_ids)} 个订阅")
        except Exception as error:
            failed += 1
            print(f"  [WARN] {label} 失败，跳过: {_safe_error(error)}")
        time.sleep(0.3)

    if dry_run:
        print(f"  [DRY] 共需调用模型 {len(pending)} 次，未调用模型、未写库")
        return
    print(f"  兴趣速览完成：生成 {generated} 个兴趣，写入 {written_total} 个订阅，失败 {failed} 个")
    if failed and IN_CI:
        print(f"::warning::兴趣速览有 {failed} 个兴趣生成失败，用户打开首页时会补生成")


def fill_interests_for_existing_digest(week_start: str | None, dry_run: bool) -> None:
    digest = load_digest_row(week_start)
    if not digest:
        print(f"[SKIP] 找不到{week_start or '最新'}一期 weekly_digests，无法生成兴趣速览")
        return
    generate_interest_digests(digest["week_start"], dry_run)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成每周研究速览，并为满一个月的兴趣补上新一份月度概览")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要生成什么：不调用模型、不写库")
    parser.add_argument(
        "--interests-only",
        action="store_true",
        help="不重新生成本周速览，只补到期的兴趣概览（范围截至最新一期，或 --week-start 指定的那期）",
    )
    parser.add_argument("--week-start", help="配合 --interests-only 指定某一期，格式 YYYY-MM-DD")
    args = parser.parse_args()
    if args.week_start:
        if not args.interests_only:
            parser.error("--week-start 只能配合 --interests-only 使用")
        try:
            dt.date.fromisoformat(args.week_start)
        except ValueError:
            parser.error("--week-start 格式应为 YYYY-MM-DD")
    return args


def run() -> None:
    args = parse_args()
    if args.dry_run:
        print("[DRY] 演练模式：不调用模型、不写库")
    if not ensure_digests_table():
        return

    if args.interests_only:
        fill_interests_for_existing_digest(args.week_start, args.dry_run)
        return

    week_start, week_end = current_week_window()
    print(f"本周窗口：{week_start.isoformat()} ~ {week_end.isoformat()}")

    articles = load_week_articles(week_start, week_end)
    if not articles or len(articles) < MIN_ARTICLES:
        if not articles:
            print("本周没有新增期刊论文，跳过")
        else:
            print(f"本周仅 {len(articles)} 篇，低于阈值 {MIN_ARTICLES}，跳过")
        # 没有新一期时，前端看到的仍是最新一期；顺带补上那一期漏掉的兴趣
        fill_interests_for_existing_digest(None, args.dry_run)
        return

    print(f"共 {len(articles)} 篇论文")
    if args.dry_run:
        print(f"[DRY] 将生成本周概览和分点总结，写入 weekly_digests（week_start={week_start.isoformat()}）")
        generate_interest_digests(week_start.isoformat(), dry_run=True)
        return

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

    generate_interest_digests(week_start.isoformat(), dry_run=False)


if __name__ == "__main__":
    run()
