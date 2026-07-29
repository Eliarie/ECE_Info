"""Exclusive primary-topic taxonomy shared by translation and retagging."""

from __future__ import annotations

TOPIC_VERSION = "ece-primary-v3"
MIN_AI_CONFIDENCE = 0.70

TOPIC_DEFINITIONS: dict[str, str] = {
    "数字教育": "Digital Education；数字媒介、屏幕、应用、机器人、编程与人工智能的教育设计、使用或影响",
    "儿童发展": "Child Development；儿童认知、语言、社会情感、身体、健康与发展轨迹",
    "教学与学习": "Teaching & Learning；教学行为、师幼互动、学习活动、支架与课堂学习过程",
    "教师教育": "Teacher Education；职前与在职教师培养、专业发展、身份、知识、信念与胜任力",
    "课程": "Curriculum；课程框架、目标、内容、组织、实施与学习环境设计",
    "游戏": "Play；游戏行为、游戏性、假装游戏、自主游戏与游戏化教学",
    "家庭与社区": "Family & Community；养育、亲子互动、家庭学习环境、家长参与与社区合作",
    "特殊教育": "Special Education；残障、自闭症、发展迟缓、特殊需要、早期干预与融合教育",
    "教育政策": "Policy & Leadership；政策、治理、领导、财政、公平可及性、质量监管与教育系统",
    "研究方法与理论": "Research Methods & Theory；研究设计、测量工具、方法学、心理测量、概念界定与理论模型",
}

TOPIC_LIST = [
    "数字教育",
    "儿童发展",
    "教学与学习",
    "教师教育",
    "课程",
    "游戏",
    "家庭与社区",
    "特殊教育",
    "教育政策",
    "研究方法与理论",
]


def taxonomy_prompt() -> str:
    definitions = "\n".join(
        f"- {name}：{TOPIC_DEFINITIONS[name]}" for name in TOPIC_LIST
    )
    return f"""主题分类必须遵守以下规则：
1. 只选择一个最能代表中心研究问题或主要知识贡献的一级分类，不按文章提到的所有概念多选。
2. 主要贡献是量表、测量、方法学、概念或理论模型时，归入“研究方法与理论”；仅使用某种研究方法不属于该类。
3. 中心问题是职前或在职教师发展时，归入“教师教育”；教师只是课堂教学实施者时，归入“教学与学习”。
4. 数字技术、游戏、特殊需要、家庭或政策是研究核心时，优先归入对应专类；它们只是背景时不优先。
5. 课程框架、内容组织或环境设计是核心时归入“课程”；具体的教学行为、互动或学习过程归入“教学与学习”。
6. 主要描述儿童发展结果、差异或轨迹，且无上述更具体的教育机制时，归入“儿童发展”。
7. 证据不足或两类无法判断时，category 返回 null，不得猜测。

可选主类别：
{definitions}"""


def validated_topic(category: object, confidence: object) -> list[str]:
    if category not in TOPIC_DEFINITIONS:
        return []
    try:
        score = float(confidence)
    except (TypeError, ValueError):
        return []
    return [str(category)] if score >= MIN_AI_CONFIDENCE else []
