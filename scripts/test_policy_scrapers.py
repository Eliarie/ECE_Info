"""Regression tests for policy and practice source scrapers."""

import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_policy import (
    PROVINCIAL_EDUCATION_SOURCES,
    extract_brookings_listing_abstract,
    should_keep_target_content,
)


class BrookingsListingTests(unittest.TestCase):
    def test_byline_and_date_are_not_treated_as_abstract(self):
        card = BeautifulSoup(
            """
            <article>
              <span class="meta">
                <p class="byline">Rebecca Winthrop</p>
                <p class="date">June 24, 2026</p>
              </span>
            </article>
            """,
            "html.parser",
        ).article

        self.assertIsNone(extract_brookings_listing_abstract(card))

    def test_explicit_summary_is_used_as_abstract(self):
        card = BeautifulSoup(
            """
            <article>
              <p class="byline">Rebecca Winthrop</p>
              <p class="summary">Teachers describe five practical risks of anthropomorphic AI.</p>
            </article>
            """,
            "html.parser",
        ).article

        self.assertEqual(
            extract_brookings_listing_abstract(card),
            "Teachers describe five practical risks of anthropomorphic AI.",
        )


class DomesticPolicyFilterTests(unittest.TestCase):
    def test_unrelated_domestic_notice_is_rejected(self):
        self.assertFalse(
            should_keep_target_content({
                "module": "policy",
                "region": "domestic",
                "title_original": "北京市教育委员会关于开展普通高中艺术节活动的通知",
            })
        )

    def test_early_childhood_policy_is_kept(self):
        self.assertTrue(
            should_keep_target_content({
                "module": "policy",
                "region": "domestic",
                "title_original": "关于印发幼儿园保育教育质量评估指南的通知",
            })
        )

    def test_generic_ai_education_policy_is_rejected(self):
        self.assertFalse(
            should_keep_target_content({
                "module": "policy",
                "region": "domestic",
                "title_original": "关于印发人工智能赋能高中教育行动方案的通知",
            })
        )

    def test_early_childhood_navigation_link_is_rejected(self):
        self.assertFalse(
            should_keep_target_content({
                "module": "policy",
                "region": "domestic",
                "title_original": "宁波幼儿师范高等专科学校",
            })
        )

    def test_preschool_education_law_is_kept(self):
        self.assertTrue(
            should_keep_target_content({
                "module": "policy",
                "region": "domestic",
                "title_original": "中华人民共和国学前教育法",
            })
        )


class ProvincialSourceCoverageTests(unittest.TestCase):
    def test_all_provincial_level_regions_are_configured(self):
        expected = {
            "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江",
            "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南",
            "湖北", "湖南", "广东", "广西", "海南", "重庆", "四川", "贵州",
            "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆",
        }
        self.assertEqual({source[0] for source in PROVINCIAL_EDUCATION_SOURCES}, expected)


if __name__ == "__main__":
    unittest.main()
