"""
政策抓取脚本
覆盖：教育部、国务院、7个城市教育局、国际机构
"""

import os
import sys
import re
import time
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from pathlib import Path
from supabase import create_client

# 修复 Windows 控制台编码问题
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')


def load_dotenv_fallback() -> None:
    """当环境变量缺失时，从项目根目录 .env 读取。"""
    root = Path(__file__).resolve().parent.parent
    env_path = root / ".env"
    if not env_path.exists():
        return

    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as e:
        print(f"[WARN] 读取 .env 失败: {e}")


load_dotenv_fallback()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def safe_get(url: str, **kwargs):
    """请求包装：超时重试一次；证书异常时降级 verify=False 重试一次。"""
    try:
        return requests.get(url, **kwargs)
    except requests.exceptions.ReadTimeout:
        timeout = kwargs.get("timeout", 10)
        retry_kwargs = dict(kwargs)
        retry_kwargs["timeout"] = max(timeout * 2, 20)
        print(f"  [WARN] 请求超时，重试: {url}")
        return requests.get(url, **retry_kwargs)
    except requests.exceptions.SSLError:
        retry_kwargs = dict(kwargs)
        retry_kwargs["verify"] = False
        retry_kwargs["timeout"] = max(kwargs.get("timeout", 10), 20)
        print(f"  [WARN] SSL 异常，降级校验重试: {url}")
        return requests.get(url, **retry_kwargs)

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "content_filters.json"

DEFAULT_EARLY_CHILDHOOD_KEYWORDS = [
    "学前", "幼儿", "托育", "早教", "幼教", "儿童早期", "婴幼儿", "幼儿园", "保教",
    "early childhood", "preschool", "pre-school", "kindergarten",
    "nursery", "daycare", "child care", "ecec", "early years", "infant", "toddler",
]

DEFAULT_AI_KEYWORDS = [
    "AI", "人工智能", "智能化", "大模型", "生成式", "AIGC",
    "machine learning", "deep learning", "LLM", "GPT",
]

DEFAULT_EDUCATION_KEYWORDS = [
    "教育", "教学", "课堂", "课程", "学校", "教师", "学生", "教研", "育人",
    "education", "teaching", "learning", "curriculum", "school", "teacher", "student",
]

DEFAULT_POLICY_DOCUMENT_KEYWORDS = [
    "政策", "通知", "通告", "公告", "意见", "办法", "方案", "规划", "指南", "指引",
    "解读", "新闻", "动态", "简报", "白皮书", "报告", "行动计划", "实施方案",
    "policy", "guideline", "guidance", "framework", "notice", "announcement",
    "news", "press release", "brief", "white paper", "report", "action plan",
]

DEFAULT_FILTER_KEYWORDS = {
    "global": {
        "early_childhood_keywords": DEFAULT_EARLY_CHILDHOOD_KEYWORDS,
        "ai_keywords": DEFAULT_AI_KEYWORDS,
        "education_keywords": DEFAULT_EDUCATION_KEYWORDS,
        "policy_document_keywords": DEFAULT_POLICY_DOCUMENT_KEYWORDS,
    },
    "domestic": {
        "early_childhood_keywords": [],
        "ai_keywords": [],
        "education_keywords": [],
        "policy_document_keywords": [],
    },
    "international": {
        "early_childhood_keywords": [],
        "ai_keywords": [],
        "education_keywords": [],
        "policy_document_keywords": [],
    },
}


def build_keyword_pattern(keywords: list[str]) -> re.Pattern:
    """从关键词列表构造大小写不敏感正则。"""
    escaped = [re.escape(k.strip()) for k in keywords if isinstance(k, str) and k.strip()]
    if not escaped:
        return re.compile(r"$^")
    return re.compile("|".join(escaped), re.IGNORECASE)


def normalize_keyword_list(values) -> list[str]:
    if not isinstance(values, list):
        return []
    return [v.strip() for v in values if isinstance(v, str) and v.strip()]


def merge_keywords(base: list[str], extra: list[str]) -> list[str]:
    seen = set()
    merged: list[str] = []
    for item in base + extra:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def normalize_filter_config(data: dict) -> dict:
    """兼容两种格式：
    1) 扁平格式：early_childhood_keywords / ai_keywords / education_keywords
    2) 分区格式：global/domestic/international 下分别配置三类关键词
    """
    # 向后兼容旧版扁平配置
    if any(k in data for k in ("early_childhood_keywords", "ai_keywords", "education_keywords")):
        return {
            "global": {
                "early_childhood_keywords": normalize_keyword_list(
                    data.get("early_childhood_keywords", DEFAULT_EARLY_CHILDHOOD_KEYWORDS)
                ),
                "ai_keywords": normalize_keyword_list(data.get("ai_keywords", DEFAULT_AI_KEYWORDS)),
                "education_keywords": normalize_keyword_list(
                    data.get("education_keywords", DEFAULT_EDUCATION_KEYWORDS)
                ),
                "policy_document_keywords": DEFAULT_POLICY_DOCUMENT_KEYWORDS,
            },
            "domestic": {
                "early_childhood_keywords": [],
                "ai_keywords": [],
                "education_keywords": [],
                "policy_document_keywords": [],
            },
            "international": {
                "early_childhood_keywords": [],
                "ai_keywords": [],
                "education_keywords": [],
                "policy_document_keywords": [],
            },
        }

    normalized = {k: dict(v) for k, v in DEFAULT_FILTER_KEYWORDS.items()}
    for scope in ("global", "domestic", "international"):
        scope_data = data.get(scope, {}) if isinstance(data.get(scope), dict) else {}
        normalized[scope] = {
            "early_childhood_keywords": normalize_keyword_list(
                scope_data.get("early_childhood_keywords", normalized[scope]["early_childhood_keywords"])
            ),
            "ai_keywords": normalize_keyword_list(
                scope_data.get("ai_keywords", normalized[scope]["ai_keywords"])
            ),
            "education_keywords": normalize_keyword_list(
                scope_data.get("education_keywords", normalized[scope]["education_keywords"])
            ),
            "policy_document_keywords": normalize_keyword_list(
                scope_data.get("policy_document_keywords", normalized[scope]["policy_document_keywords"])
            ),
        }

    # global 为空时回退默认，避免规则失效
    if not normalized["global"]["early_childhood_keywords"]:
        normalized["global"]["early_childhood_keywords"] = DEFAULT_EARLY_CHILDHOOD_KEYWORDS
    if not normalized["global"]["ai_keywords"]:
        normalized["global"]["ai_keywords"] = DEFAULT_AI_KEYWORDS
    if not normalized["global"]["education_keywords"]:
        normalized["global"]["education_keywords"] = DEFAULT_EDUCATION_KEYWORDS
    if not normalized["global"]["policy_document_keywords"]:
        normalized["global"]["policy_document_keywords"] = DEFAULT_POLICY_DOCUMENT_KEYWORDS

    return normalized


def load_filter_keywords() -> dict:
    """从 config/content_filters.json 读取关键词；缺失时使用默认值。"""
    if not CONFIG_PATH.exists():
        print(f"[WARN] 未找到关键词配置文件，使用默认关键词: {CONFIG_PATH}")
        return DEFAULT_FILTER_KEYWORDS

    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        normalized = normalize_filter_config(data if isinstance(data, dict) else {})
        print(f"[OK] 已加载关键词配置: {CONFIG_PATH}")
        return normalized
    except Exception as e:
        print(f"[WARN] 关键词配置读取失败，使用默认关键词: {e}")
        return DEFAULT_FILTER_KEYWORDS


def build_region_patterns(config: dict) -> dict:
    patterns = {}
    global_cfg = config.get("global", {})
    for scope in ("global", "domestic", "international"):
        scope_cfg = config.get(scope, {})
        early = merge_keywords(
            normalize_keyword_list(global_cfg.get("early_childhood_keywords", [])),
            normalize_keyword_list(scope_cfg.get("early_childhood_keywords", [])),
        )
        ai = merge_keywords(
            normalize_keyword_list(global_cfg.get("ai_keywords", [])),
            normalize_keyword_list(scope_cfg.get("ai_keywords", [])),
        )
        education = merge_keywords(
            normalize_keyword_list(global_cfg.get("education_keywords", [])),
            normalize_keyword_list(scope_cfg.get("education_keywords", [])),
        )
        policy_document = merge_keywords(
            normalize_keyword_list(global_cfg.get("policy_document_keywords", [])),
            normalize_keyword_list(scope_cfg.get("policy_document_keywords", [])),
        )
        patterns[scope] = {
            "early": build_keyword_pattern(early),
            "ai": build_keyword_pattern(ai),
            "education": build_keyword_pattern(education),
            "policy_document": build_keyword_pattern(policy_document),
        }
    return patterns


FILTER_KEYWORDS = load_filter_keywords()
REGION_PATTERNS = build_region_patterns(FILTER_KEYWORDS)


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


def should_keep_target_content(article: dict) -> bool:
    """统一保留规则：
    - policy: 学前相关 OR (AI+教育) OR 政策文件关键词（通知/指南/新闻等）
    - research_practice: 学前相关 OR (AI+教育)
    """
    region = article.get("region") if article.get("region") in {"domestic", "international"} else "global"
    module = article.get("module")
    patterns = REGION_PATTERNS.get(region, REGION_PATTERNS["global"])
    text = " ".join([
        article.get("title_original") or "",
        article.get("title_zh") or "",
        article.get("abstract_original") or "",
        article.get("abstract_zh") or "",
    ])
    if patterns["early"].search(text):
        return True
    if module == "policy" and patterns["policy_document"].search(text):
        return True
    return bool(patterns["ai"].search(text) and patterns["education"].search(text))


def save_articles(articles: list[dict]) -> dict:
    if not articles:
        return {"raw": 0, "kept": 0, "filtered": 0}
    filtered = []
    filtered_out = 0
    global_patterns = REGION_PATTERNS["global"]
    for a in articles:
        module = a.get("module")
        # 统一策略：政策 + 实践探索（国内/国际）都执行同一规则
        if module in {"policy", "research_practice"}:
            if should_keep_target_content(a):
                filtered.append(a)
            else:
                filtered_out += 1
            continue

        # 其他模块默认按学前关键词过滤，避免噪声入库
        text = " ".join([
            a.get("title_original") or "",
            a.get("title_zh") or "",
            a.get("abstract_original") or "",
            a.get("abstract_zh") or "",
        ])
        if global_patterns["early"].search(text):
            filtered.append(a)
        else:
            filtered_out += 1

    if not filtered:
        print("  [OK] 保存 0 条（已过滤无关内容）")
        return {"raw": len(articles), "kept": 0, "filtered": filtered_out}

    supabase.table("articles").upsert(filtered, on_conflict="source_url", ignore_duplicates=True).execute()
    print(f"  [OK] 保存 {len(filtered)} 条（原始 {len(articles)} 条，过滤 {filtered_out} 条）")
    return {"raw": len(articles), "kept": len(filtered), "filtered": filtered_out}


def scrape_moe():
    """教育部 - 规范性文件列表"""
    articles = []
    urls = [
        "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/",   # 规范性文件
        "https://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/s5987/", # 工作动态
    ]
    for url in urls:
        try:
            resp = safe_get(url, headers=HEADERS, timeout=10)
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
        resp = safe_get(list_url, headers=HEADERS, timeout=10)
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
        resp = safe_get(
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
        resp = safe_get(
            "https://omep.org/wp-json/wp/v2/posts?per_page=10&orderby=date",
            headers=HEADERS, timeout=10
        )
        payload = resp.json()
        posts = payload if isinstance(payload, list) else []
        for post in posts:
            if not isinstance(post, dict):
                continue
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
        resp = safe_get(
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
        resp = safe_get(
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

    stats = {"raw": 0, "kept": 0, "filtered": 0}

    def collect(result: dict):
        stats["raw"] += result["raw"]
        stats["kept"] += result["kept"]
        stats["filtered"] += result["filtered"]

    print("=== 抓取 国内政策 ===")

    print("  教育部...")
    collect(save_articles(scrape_moe()))
    time.sleep(1)

    print("  上海市教育局...")
    collect(save_articles(scrape_shanghai()))
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
        collect(save_articles(scrape_city(name, url, base)))
        time.sleep(1)

    print("=== 抓取 国际机构 ===")

    print("  OMEP...")
    collect(save_articles(scrape_omep()))
    time.sleep(1)

    print("  Brookings...")
    collect(save_articles(scrape_brookings()))
    time.sleep(1)

    print("  Harvard Center...")
    collect(save_articles(scrape_harvard()))

    print("\n=== 过滤统计汇总 ===")
    print(f"  原始抓取: {stats['raw']} 条")
    print(f"  过滤剔除: {stats['filtered']} 条")
    print(f"  最终入库: {stats['kept']} 条")
    keep_rate = (stats["kept"] / stats["raw"] * 100) if stats["raw"] > 0 else 0
    print(f"  保留率: {keep_rate:.1f}%")

    print("\n政策抓取完成")


if __name__ == "__main__":
    run()
