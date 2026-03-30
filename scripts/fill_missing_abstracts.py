"""
对缺摘要的文章，用 DeepSeek 根据标题生成简短中文摘要。
用法：
  SUPABASE_URL=... SUPABASE_KEY=... DEEPSEEK_API_KEY=... python scripts/fill_missing_abstracts.py
"""

import os
import time
from openai import OpenAI
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

BATCH_SIZE = 30


def generate_abstract(title_original: str, title_zh: str | None) -> str | None:
    """根据标题让 DeepSeek 生成简短中文摘要（2-4句）"""
    display_title = title_zh or title_original
    prompt = f"""你是学前教育领域的学术助手。以下是一篇学术论文的标题，该论文原文摘要不可获取。
请根据标题推断研究内容，用中文写一段简短的摘要（2-4句，约80-120字），说明该研究可能的研究问题、方法和意义。
注意：请在摘要开头注明"（摘要由AI根据标题生成）"。

论文标题：{display_title}
原文标题：{title_original}

只输出摘要文本，不要其他内容。"""

    try:
        resp = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=300,
        )
        return resp.choices[0].message.content.strip() or None
    except Exception as e:
        print(f"  [ERR] DeepSeek 调用失败: {e}")
        return None


def run():
    # 查找缺摘要的已翻译文章（国际来源）
    result = supabase.table("articles") \
        .select("id, title_original, title_zh") \
        .is_("abstract_original", "null") \
        .is_("abstract_zh", "null") \
        .eq("region", "international") \
        .limit(BATCH_SIZE) \
        .execute()

    articles = result.data
    if not articles:
        print("没有缺摘要的文章")
        return

    print(f"找到 {len(articles)} 篇缺摘要文章，开始生成...")

    for i, article in enumerate(articles):
        abstract_zh = generate_abstract(article["title_original"], article.get("title_zh"))
        if abstract_zh:
            supabase.table("articles").update({
                "abstract_zh": abstract_zh,
            }).eq("id", article["id"]).execute()
            print(f"  [{i+1}/{len(articles)}] {article['title_original'][:50]}…")
        else:
            print(f"  [{i+1}/{len(articles)}] [跳过] {article['title_original'][:50]}…")
        time.sleep(0.5)

    print("完成")


if __name__ == "__main__":
    run()
