import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from topic_classifier import TOPIC_PATTERNS, classify_topics
from topic_taxonomy import MIN_AI_CONFIDENCE, TOPIC_LIST, taxonomy_prompt, validated_topic


class TopicTaxonomyTests(unittest.TestCase):
    def test_taxonomy_has_unique_exclusive_categories(self):
        self.assertEqual(TOPIC_LIST, [
            "数字教育", "儿童发展", "教学与学习", "教师教育", "课程", "游戏",
            "家庭与社区", "特殊教育", "教育政策", "研究方法与理论",
        ])
        self.assertEqual(len(TOPIC_LIST), len(set(TOPIC_LIST)))
        self.assertEqual(list(TOPIC_PATTERNS), TOPIC_LIST)
        self.assertLess(taxonomy_prompt().index("- 数字教育："), taxonomy_prompt().index("- 儿童发展："))

    def test_classifier_returns_at_most_one_category(self):
        samples = [
            ("Digital storybooks in preschool", "Educational technology and tablet use", "数字教育"),
            ("Vocabulary growth in preschool", "A child development study of early literacy", "儿童发展"),
            ("Preservice teacher beliefs", "Teacher education and professional learning", "教师教育"),
            ("Parent-child interaction", "The home learning environment and family engagement", "家庭与社区"),
            ("Scale validation", "Psychometric properties and measurement invariance", "研究方法与理论"),
        ]
        for title, abstract, expected in samples:
            self.assertEqual(classify_topics(title, abstract), [expected])

    def test_classifier_abstains_when_topics_are_tied(self):
        result = classify_topics(
            "Guided play and preservice teachers",
            "A study in kindergarten.",
        )
        self.assertEqual(result, [])

    def test_ai_category_requires_known_label_and_confidence(self):
        self.assertEqual(validated_topic("儿童发展", MIN_AI_CONFIDENCE), ["儿童发展"])
        self.assertEqual(validated_topic("儿童发展", MIN_AI_CONFIDENCE - 0.01), [])
        self.assertEqual(validated_topic("随意分类", 0.99), [])


if __name__ == "__main__":
    unittest.main()
