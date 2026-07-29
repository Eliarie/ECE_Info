"""Conservative single-topic classifier used before AI classification."""

from __future__ import annotations

import re

from topic_taxonomy import TOPIC_LIST

# These rules provide an immediate provisional category. Broad or tied results
# are left empty for the AI pass, which applies the full central-question rules.
_TOPIC_PATTERNS: dict[str, tuple[str, ...]] = {
    "儿童发展": (
        r"\bchild development\b", r"\bdevelopmental trajector(?:y|ies)\b", r"\blanguage development\b",
        r"\bliteracy\b", r"\bvocabular(?:y|ies)\b", r"\bnumeracy\b", r"\bnumber sense\b",
        r"\bsocial[- ]emotional\b", r"\bself[- ]regulation\b", r"\bexecutive function\b",
        r"\bworking memory\b", r"\bmotor skills?\b", r"\bphysical development\b",
        r"儿童发展", r"发展轨迹", r"语言发展", r"早期读写", r"词汇", r"数感",
        r"社会情感", r"自我调节", r"执行功能", r"工作记忆", r"动作发展",
    ),
    "教学与学习": (
        r"\bteaching and learning\b", r"\binstructional practice\b", r"\bclassroom interaction\b",
        r"\bteacher[- ]child interaction\b", r"\bscaffolding\b", r"\bpedagog(?:y|ical)\b",
        r"\blearning activit(?:y|ies)\b", r"\bclassroom practice\b", r"\bformative assessment\b",
        r"教学与学习", r"教学实践", r"课堂互动", r"师幼互动", r"教学支架", r"学习活动", r"形成性评价",
    ),
    "教师教育": (
        r"\bteacher education\b", r"\bpreservice teachers?\b", r"\bpre-service teachers?\b",
        r"\bin-service teachers?\b", r"\bprofessional development\b", r"\bprofessional learning\b",
        r"\bteacher identit(?:y|ies)\b", r"\bteacher beliefs?\b", r"\bteacher self-efficacy\b",
        r"\bteacher competenc(?:e|ies)\b", r"\bteacher wellbeing\b",
        r"教师教育", r"职前教师", r"在职教师", r"专业发展", r"专业学习",
        r"教师身份", r"教师信念", r"教师自我效能", r"教师胜任力", r"教师福祉",
    ),
    "课程": (
        r"\bcurriculum framework\b", r"\bcurriculum design\b", r"\bcurriculum implementation\b",
        r"\bcurriculum content\b", r"\bcurriculum reform\b", r"\blearning environment design\b",
        r"\bclassroom environment\b", r"\bpreschool curriculum\b",
        r"课程框架", r"课程设计", r"课程实施", r"课程内容", r"课程改革", r"学习环境设计", r"班级环境", r"幼儿园课程",
    ),
    "游戏": (
        r"\bplay[- ]based\b", r"\bplayful learning\b", r"\bpretend play\b", r"\bfree play\b",
        r"\boutdoor play\b", r"\bguided play\b", r"\bdramatic play\b", r"\bplay pedagogy\b",
        r"游戏化", r"假装游戏", r"自主游戏", r"户外游戏", r"引导性游戏", r"角色游戏", r"游戏教学",
    ),
    "家庭与社区": (
        r"\bparenting\b", r"\bparent[- ]child interaction\b", r"\bhome learning environment\b",
        r"\bfamily engagement\b", r"\bparent engagement\b", r"\bfamily[- ]school partnership\b",
        r"\bcommunity partnership\b", r"\bcaregiver sensitivity\b", r"\bcommunity-based\b",
        r"家庭养育", r"亲子互动", r"家庭学习环境", r"家长参与", r"家园共育", r"社区合作", r"社区为本",
    ),
    "特殊教育": (
        r"\bspecial education\b", r"\bautis(?:m|tic)\b", r"\bASD\b", r"\bdisabilit(?:y|ies)\b",
        r"\bdevelopmental delay\b", r"\bearly intervention\b", r"\binclusive education\b",
        r"\bspecial needs?\b", r"\bindividuali[sz]ed education\b",
        r"特殊教育", r"自闭症", r"孤独症", r"残障", r"发展迟缓", r"早期干预", r"融合教育", r"特殊需要", r"个别化教育",
    ),
    "教育政策": (
        r"\bearly childhood policy\b", r"\bECEC policy\b", r"\beducation policy\b",
        r"\bpolicy implementation\b", r"\bleadership\b", r"\bgovernance\b", r"\bpublic funding\b",
        r"\buniversal pre[- ]k\b", r"\bchildcare access\b", r"\baccreditation\b",
        r"\bstructural quality\b", r"\bworkforce policy\b", r"\beducational equity\b",
        r"学前教育政策", r"托育政策", r"政策实施", r"教育领导", r"教育治理", r"公共财政",
        r"普惠托育", r"入园机会", r"质量监管", r"教师队伍政策", r"教育公平",
    ),
    "数字教育": (
        r"\bartificial intelligence\b", r"\bgenerative AI\b", r"\bmachine learning\b",
        r"\bdigital education\b", r"\bdigital technolog(?:y|ies)\b", r"\beducational technolog(?:y|ies)\b",
        r"\bscreen media\b", r"\bscreen time\b", r"\beducational robots?\b", r"\btablet use\b",
        r"\bdigital stor(?:y|ies|ybook|ybooks)\b", r"\bcoding education\b", r"\bcomputational thinking\b",
        r"人工智能", r"生成式AI", r"数字教育", r"数字技术", r"教育技术", r"屏幕媒介", r"屏幕时间",
        r"教育机器人", r"平板电脑", r"数字故事", r"编程教育", r"计算思维",
    ),
    "研究方法与理论": (
        r"\bresearch methodolog(?:y|ical)\b", r"\bmethodological framework\b", r"\bmeasure development\b",
        r"\bscale development\b", r"\bscale validation\b", r"\binstrument validation\b",
        r"\bpsychometric(?:s| properties)?\b", r"\bmeasurement invariance\b", r"\btheoretical framework\b",
        r"\bconceptual framework\b", r"\btheory development\b", r"\bconstruct validity\b",
        r"研究方法学", r"方法学框架", r"测量工具开发", r"量表开发", r"量表验证", r"工具验证",
        r"心理测量", r"测量不变性", r"理论框架", r"概念框架", r"理论建构", r"构念效度",
    ),
}

assert set(_TOPIC_PATTERNS) == set(TOPIC_LIST)
TOPIC_PATTERNS = {label: _TOPIC_PATTERNS[label] for label in TOPIC_LIST}


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
