"""
DeepSeek 翻译脚本
批量翻译数据库中未翻译的国际来源文章（标题+摘要）
"""

import os
import time
from openai import OpenAI  # DeepSeek兼容OpenAI SDK
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

BATCH_SIZE = 20  # 每次处理20篇


def translate(title: str, abstract: str | None) -> tuple[str, str | None]:
    """调用DeepSeek翻译标题和摘要"""
    content = f"标题：{title}"
    if abstract:
        content += f"\n\n摘要：{abstract}"

    prompt = f"""请将以下学术内容翻译成中文，保持学术准确性，输出格式严格如下：
标题：[中文标题]
摘要：[中文摘要]（如无摘要则输出"无"）

{content}"""

    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=800,
    )
    text = resp.choices[0].message.content.strip()

    # 解析输出
    title_zh = ""
    abstract_zh = None
    for line in text.split("\n"):
        if line.startswith("标题："):
            title_zh = line[3:].strip()
        elif line.startswith("摘要："):
            val = line[3:].strip()
            abstract_zh = None if val == "无" else val

    return title_zh or title, abstract_zh


def run():
    # 查询未翻译的国际来源文章
    result = supabase.table("articles")\
        .select("id, title_original, abstract_original")\
        .eq("is_translated", False)\
        .eq("region", "international")\
        .limit(BATCH_SIZE)\
        .execute()

    articles = result.data
    if not articles:
        print("没有需要翻译的文章")
        return

    print(f"开始翻译 {len(articles)} 篇文章...")

    for i, article in enumerate(articles):
        try:
            title_zh, abstract_zh = translate(
                article["title_original"],
                article.get("abstract_original")
            )
            supabase.table("articles").update({
                "title_zh": title_zh,
                "abstract_zh": abstract_zh,
                "is_translated": True,
            }).eq("id", article["id"]).execute()

            print(f"  [{i+1}/{len(articles)}] {article['title_original'][:40]}...")
            time.sleep(0.5)  # 避免触发速率限制

        except Exception as e:
            print(f"  [ERR] {article['id']}: {e}")
            time.sleep(2)

    print("翻译完成")


if __name__ == "__main__":
    run()
