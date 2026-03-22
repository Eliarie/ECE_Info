"""
存量数据补打主题标签脚本
给已翻译但 topic_tags 为空的文章，用 DeepSeek 补打标签。
用法：
  SUPABASE_URL=... SUPABASE_KEY=... DEEPSEEK_API_KEY=... python scripts/retag.py
"""

import os
import sys
import json
import time
from openai import OpenAI
from supabase import create_client

# 修复 Windows 控制台编码问题
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

BATCH_SIZE = 50

TOPIC_LIST = [
    "数学与STEM", "语言与读写", "社会情感发展", "游戏与学习",
    "教师与教学", "家庭与亲子", "科技与AI", "健康与体育",
    "特殊需要与融合", "评估与测量", "课程与环境", "政策与质量",
    "认知与神经", "创造力与艺术",
]
TOPIC_LIST_STR = "、".join(TOPIC_LIST)


def tag_article(title: str, abstract: str | None) -> list[str]:
    content = f"标题：{title}"
    if abstract:
        content += f"\n\n摘要：{abstract}"

    prompt = f"""你是学前教育领域的学术助手。从以下主题列表中选出最匹配的1-3个标签（可以不选，不能超出列表范围）：
{TOPIC_LIST_STR}

输出格式（JSON，不要有其他内容）：
{{"topics": ["标签1", "标签2"]}}

{content}"""

    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=100,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content.strip()
    try:
        data = json.loads(raw)
        return [t for t in (data.get("topics") or []) if t in TOPIC_LIST]
    except Exception:
        return []


def run():
    # 查找 topic_tags 为空数组的文章（已翻译或国内文章）
    result = supabase.table("articles") \
        .select("id, title_original, title_zh, abstract_original, abstract_zh") \
        .eq("topic_tags", "[]") \
        .limit(BATCH_SIZE) \
        .execute()

    articles = result.data
    if not articles:
        print("没有需要补标签的文章")
        return

    print(f"开始为 {len(articles)} 篇文章打标签...")

    for i, article in enumerate(articles):
        title = article.get("title_zh") or article.get("title_original", "")
        abstract = article.get("abstract_zh") or article.get("abstract_original")
        try:
            topics = tag_article(title, abstract)
            supabase.table("articles").update({
                "topic_tags": topics,
            }).eq("id", article["id"]).execute()
            print(f"  [{i+1}/{len(articles)}] {title[:40]}… → {topics}")
            time.sleep(0.3)
        except Exception as e:
            print(f"  [ERR] {article['id']}: {e}")
            time.sleep(2)

    print("补标签完成，如还有未处理的文章请再次运行")


if __name__ == "__main__":
    run()
