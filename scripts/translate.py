"""
DeepSeek 翻译 + AI 主题分类脚本
批量翻译数据库中未翻译的国际来源文章（标题+摘要），同时用 AI 打主题标签
"""

import os
import json
import time
from openai import OpenAI
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

BATCH_SIZE = 20

TOPIC_LIST = [
    "数学与STEM", "语言与读写", "社会情感发展", "游戏与学习",
    "教师与教学", "家庭与亲子", "科技与AI", "健康与体育",
    "特殊需要与融合", "评估与测量", "课程与环境", "政策与质量",
    "认知与神经", "创造力与艺术",
]
TOPIC_LIST_STR = "、".join(TOPIC_LIST)


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


def translate_and_tag(title: str, abstract: str | None) -> tuple[str, str | None, list[str]]:
    """调用 DeepSeek 翻译标题/摘要，并返回主题标签列表"""
    content = f"标题：{title}"
    if abstract:
        content += f"\n\n摘要：{abstract}"

    prompt = f"""你是学前教育领域的学术助手。请完成以下两项任务：

1. 将学术内容翻译成中文（保持学术准确性）
2. 从以下主题列表中选出最匹配的1-3个标签（可以不选，但不能超出列表范围）：
   {TOPIC_LIST_STR}

输出格式严格如下（JSON，不要有其他内容）：
{{
  "title_zh": "中文标题",
  "abstract_zh": "中文摘要（无摘要则为null）",
  "topics": ["标签1", "标签2"]
}}

{content}"""

    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1000,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content.strip()

    try:
        data = json.loads(raw)
    except Exception:
        # JSON 解析失败，降级为纯文本解析
        return title, None, []

    title_zh = data.get("title_zh") or title
    abstract_zh = data.get("abstract_zh") or None
    topics = [t for t in (data.get("topics") or []) if t in TOPIC_LIST]

    return title_zh, abstract_zh, topics


def run():
    if not ensure_articles_table():
        return

    result = supabase.table("articles") \
        .select("id, title_original, abstract_original") \
        .eq("is_translated", False) \
        .eq("region", "international") \
        .limit(BATCH_SIZE) \
        .execute()

    articles = result.data
    if not articles:
        print("没有需要翻译的文章")
        return

    print(f"开始翻译 + 分类 {len(articles)} 篇文章...")

    for i, article in enumerate(articles):
        try:
            title_zh, abstract_zh, topics = translate_and_tag(
                article["title_original"],
                article.get("abstract_original"),
            )
            supabase.table("articles").update({
                "title_zh": title_zh,
                "abstract_zh": abstract_zh,
                "topic_tags": topics,
                "is_translated": True,
            }).eq("id", article["id"]).execute()

            print(f"  [{i+1}/{len(articles)}] {article['title_original'][:40]}… → {topics}")
            time.sleep(0.5)

        except Exception as e:
            print(f"  [ERR] {article['id']}: {e}")
            time.sleep(2)

    print("翻译 + 分类完成")


if __name__ == "__main__":
    run()
