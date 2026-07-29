import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from topic_classifier import classify_topics
from topic_taxonomy import MIN_AI_CONFIDENCE, TOPIC_LIST, validated_topic


class TopicTaxonomyTests(unittest.TestCase):
    def test_taxonomy_has_unique_exclusive_categories(self):
        self.assertEqual(len(TOPIC_LIST), 12)
        self.assertEqual(len(TOPIC_LIST), len(set(TOPIC_LIST)))

    def test_classifier_returns_at_most_one_category(self):
        samples = [
            ("Vocabulary growth in preschool", "Early literacy and narrative skills"),
            ("Executive function in kindergarten", "Working memory and inhibitory control"),
            ("Parent-child interaction", "The home learning environment and family engagement"),
        ]
        for title, abstract in samples:
            self.assertLessEqual(len(classify_topics(title, abstract)), 1)

    def test_classifier_abstains_when_topics_are_tied(self):
        result = classify_topics(
            "Outdoor play and motor skills",
            "A study of outdoor play and motor skills in preschool.",
        )
        self.assertEqual(result, [])

    def test_ai_category_requires_known_label_and_confidence(self):
        self.assertEqual(validated_topic("语言与读写", MIN_AI_CONFIDENCE), ["语言与读写"])
        self.assertEqual(validated_topic("语言与读写", MIN_AI_CONFIDENCE - 0.01), [])
        self.assertEqual(validated_topic("随意分类", 0.99), [])


if __name__ == "__main__":
    unittest.main()
