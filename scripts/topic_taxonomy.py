"""Exclusive primary-topic taxonomy shared by translation and retagging."""

from __future__ import annotations

TOPIC_VERSION = "ece-primary-v2"
MIN_AI_CONFIDENCE = 0.70

TOPIC_DEFINITIONS: dict[str, str] = {
    "语言与读写": "语言发展、词汇、叙事、语音、阅读、书写、多语与早期读写",
    "数学与科学": "数感、计数、算术、空间思维、科学探究与STEM学习",
    "社会情感与心理": "情绪、自我调节、依恋、同伴关系、亲社会行为、心理健康与行为问题",
    "认知与学习": "执行功能、工作记忆、注意、推理、元认知与一般学习机制",
    "身体健康与运动": "大小肌肉动作、体力活动、营养、睡眠、肥胖与身体健康",
    "艺术与创造": "音乐、舞蹈、戏剧、绘画、视觉艺术与创造性表达",
    "游戏课程与环境": "游戏、课程设计、班级环境、户外环境、材料与学习空间",
    "教师专业与教学": "教师教育、专业发展、教师信念与福祉、教学实践、师幼互动",
    "家庭社区与家园共育": "养育、亲子互动、家庭学习环境、家长参与、家园及社区合作",
    "特殊教育与融合": "残障、自闭症、发展迟缓、特殊教育、早期干预与融合服务",
    "数字技术与AI": "数字媒介、屏幕、教育机器人、编程、人工智能及技术的设计或使用",
    "政策质量与治理": "政策、法规、财政、公平可及性、系统治理、机构质量监管与劳动力政策",
}

TOPIC_LIST = list(TOPIC_DEFINITIONS)


def taxonomy_prompt() -> str:
    definitions = "\n".join(
        f"- {name}：{definition}" for name, definition in TOPIC_DEFINITIONS.items()
    )
    return f"""主题分类必须遵守以下规则：
1. 只根据文献的中心研究问题选择一个主类别，不要因为背景中提到某概念就分类。
2. 研究某个儿童发展结果时，优先归入对应的发展领域；工具、教师或家长只是干预载体时，不归入载体类别。
3. 只有技术本身的设计、使用、接受或影响是中心问题时，才归入“数字技术与AI”。
4. 测量工具、统计方法、年龄、地区和期刊不是主题类别。
5. 证据不足或两类无法判断时，category 返回 null，不得猜测。

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
