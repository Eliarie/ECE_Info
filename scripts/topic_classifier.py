"""Conservative single-topic classifier used before AI classification."""

from __future__ import annotations

import re

from topic_taxonomy import TOPIC_LIST

# Patterns intentionally omit broad words such as "learning", "child", "teacher",
# "home", and "quality". Ambiguous records are left unclassified for the AI pass.
TOPIC_PATTERNS: dict[str, tuple[str, ...]] = {
    "语言与读写": (
        r"\bliteracy\b", r"\bread(?:ing)?\b", r"\bwriting\b", r"\bvocabular(?:y|ies)\b",
        r"\bphon(?:ics|ological|emic)\b", r"\bnarrative\b", r"\bbilingual\b", r"\bmultilingual\b",
        r"语言发展", r"早期阅读", r"词汇", r"语音", r"叙事", r"双语", r"多语",
    ),
    "数学与科学": (
        r"\bmath(?:ematic(?:s|al))?\b", r"\bnumeracy\b", r"\bnumber sense\b", r"\bcounting\b",
        r"\barithmetic\b", r"\bspatial reasoning\b", r"\bscience inquiry\b", r"\bSTEM\b",
        r"数感", r"计数", r"算术", r"数学", r"科学探究", r"空间思维",
    ),
    "社会情感与心理": (
        r"social[- ]emotional", r"\bemotion(?:al|s)?\b", r"self[- ]regulation", r"\battachment\b",
        r"\bprosocial\b", r"\bpeer relations?\b", r"\bfriendship\b", r"\btemperament\b",
        r"\banxiety\b", r"\bdepression\b", r"\bmental health\b", r"\bbehavior problems?\b",
        r"社会情感", r"情绪", r"自我调节", r"依恋", r"同伴关系", r"亲社会", r"心理健康", r"行为问题",
    ),
    "认知与学习": (
        r"executive function", r"working memory", r"cognitive flexibility", r"\bmetacognition\b",
        r"\battention control\b", r"\binhibitory control\b", r"\bcausal reasoning\b",
        r"执行功能", r"工作记忆", r"认知灵活性", r"元认知", r"注意控制", r"抑制控制", r"因果推理",
    ),
    "身体健康与运动": (
        r"\bmotor skills?\b", r"\bphysical activity\b", r"\bnutrition\b", r"\bsleep\b",
        r"\bobesity\b", r"\bbody mass index\b", r"\bBMI\b", r"\bphysical health\b",
        r"动作发展", r"运动能力", r"体力活动", r"营养", r"睡眠", r"肥胖", r"身体健康",
    ),
    "艺术与创造": (
        r"\bmusic education\b", r"\bvisual arts?\b", r"\bdance education\b", r"\bdrama education\b",
        r"\bdrawing\b", r"\bcreative expression\b", r"\bcreativity\b",
        r"音乐教育", r"视觉艺术", r"舞蹈教育", r"戏剧教育", r"绘画", r"创造性表达",
    ),
    "游戏课程与环境": (
        r"\bplay[- ]based\b", r"\bplayful learning\b", r"\bpretend play\b", r"\bfree play\b",
        r"\boutdoor play\b", r"\bcurriculum design\b", r"\bclassroom environment\b",
        r"\blearning environment\b", r"\bloose parts\b",
        r"游戏化", r"假装游戏", r"自主游戏", r"户外游戏", r"课程设计", r"班级环境", r"学习环境",
    ),
    "教师专业与教学": (
        r"\bteacher education\b", r"\bprofessional development\b", r"\bteacher beliefs?\b",
        r"\bteacher wellbeing\b", r"\bteacher practices?\b", r"\bpedagog(?:y|ical)\b",
        r"\bteacher[- ]child interaction\b", r"\binstructional practice\b",
        r"教师教育", r"专业发展", r"教师信念", r"教师福祉", r"教学实践", r"师幼互动",
    ),
    "家庭社区与家园共育": (
        r"\bparenting\b", r"\bparent[- ]child interaction\b", r"\bhome learning environment\b",
        r"\bfamily engagement\b", r"\bparent engagement\b", r"\bfamily[- ]school partnership\b",
        r"\bcommunity partnership\b", r"\bcaregiver sensitivity\b",
        r"家庭养育", r"亲子互动", r"家庭学习环境", r"家长参与", r"家园共育", r"社区合作",
    ),
    "特殊教育与融合": (
        r"\bspecial education\b", r"\bautis(?:m|tic)\b", r"\bASD\b", r"\bdisabilit(?:y|ies)\b",
        r"\bdevelopmental delay\b", r"\bearly intervention\b", r"\binclusive education\b",
        r"特殊教育", r"自闭症", r"孤独症", r"残障", r"发展迟缓", r"早期干预", r"融合教育",
    ),
    "数字技术与AI": (
        r"\bartificial intelligence\b", r"\bgenerative AI\b", r"\bmachine learning\b",
        r"\bdigital technolog(?:y|ies)\b", r"\bscreen media\b", r"\bscreen time\b",
        r"\beducational robots?\b", r"\btablet use\b", r"\bcoding education\b", r"\bcomputational thinking\b",
        r"人工智能", r"生成式AI", r"数字技术", r"屏幕媒介", r"屏幕时间", r"教育机器人", r"编程教育", r"计算思维",
    ),
    "政策质量与治理": (
        r"\bearly childhood policy\b", r"\bECEC policy\b", r"\bpublic funding\b",
        r"\buniversal pre[- ]k\b", r"\bchildcare access\b", r"\bECEC access\b",
        r"\baccreditation\b", r"\bstructural quality\b", r"\bprocess quality\b", r"\bworkforce policy\b",
        r"学前教育政策", r"托育政策", r"公共财政", r"普惠托育", r"入园机会", r"质量监管", r"教师队伍政策",
    ),
}

assert list(TOPIC_PATTERNS) == TOPIC_LIST


def _score(text: str, patterns: tuple[str, ...], weight: int) -> int:
    return sum(weight for pattern in patterns if re.search(pattern, text, re.IGNORECASE))


def classify_topics(title: str, abstract: str | None) -> list[str]:
    """Return one high-confidence primary category, or [] when ambiguous."""
    title_text = title or ""
    abstract_text = abstract or ""
    scores = {
        label: _score(title_text, patterns, 4) + _score(abstract_text, patterns, 1)
        for label, patterns in TOPIC_PATTERNS.items()
    }
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_label, best_score = ranked[0]
    second_score = ranked[1][1]
    if best_score < 3 or best_score - second_score < 2:
        return []
    return [best_label]
