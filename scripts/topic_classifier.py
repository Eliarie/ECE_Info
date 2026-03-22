"""
主题分类器 - 根据标题/摘要关键词自动打标签
供 fetch_journals.py 和 backfill_2026.py 共用
"""

import re

# 主题规则：(标签, 关键词正则)
# 顺序无关，一篇文章可以有多个标签
TOPIC_RULES: list[tuple[str, str]] = [
    ("数学与STEM",      r"math|mathematics|numeracy|STEM|science|number sense|counting|arithmetic|数学|数感|计算"),
    ("语言与读写",      r"language|literacy|reading|writing|phonics|vocabulary|bilingual|multilingual|语言|阅读|识字|双语|词汇"),
    ("社会情感发展",    r"social.emotional|emotion|self.regulation|attachment|peer|friendship|behavior|prosocial|社会性|情绪|自我调节|依恋|同伴"),
    ("游戏与学习",      r"play|playful learning|play-based|pretend play|outdoor play|游戏|玩耍|户外"),
    ("教师与教学",      r"teacher|pedagogy|teaching|instruction|professional development|educator|curriculum|教师|教学|课程|专业发展"),
    ("家庭与亲子",      r"parent|family|home|caregiver|mother|father|parenting|家庭|亲子|父母|家长"),
    ("科技与AI",        r"technology|digital|AI|artificial intelligence|machine learning|XAI|explainable|robot|screen|app|tablet|科技|人工智能|数字|机器人"),
    ("健康与体育",      r"health|physical|motor|nutrition|obesity|sleep|exercise|outdoor|身体|健康|运动|体育|营养"),
    ("特殊需要与融合",  r"special need|disability|autism|ASD|inclusion|inclusive|intervention|delay|特殊|融合|自闭|干预|残障"),
    ("评估与测量",      r"assessment|measure|test|scale|instrument|validity|reliability|评估|测量|量表|测试"),
    ("课程与环境",      r"curriculum|environment|classroom|setting|preschool|kindergarten|childcare|center|课程|环境|幼儿园|托育"),
    ("政策与质量",      r"policy|quality|standard|regulation|funding|access|equity|政策|质量|标准|公平|普惠"),
    ("认知与神经",      r"cognitive|cognition|executive function|working memory|attention|brain|neural|认知|执行功能|工作记忆|注意力|大脑"),
    ("创造力与艺术",    r"creative|creativity|art|music|drama|drawing|imagination|创造|艺术|音乐|绘画|想象"),
]


def classify_topics(title: str, abstract: str | None) -> list[str]:
    """返回匹配的主题标签列表"""
    text = (title or "") + " " + (abstract or "")
    tags = []
    for label, pattern in TOPIC_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            tags.append(label)
    return tags
