"""Regression tests for policy and practice source scrapers."""

import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_policy import extract_brookings_listing_abstract


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


if __name__ == "__main__":
    unittest.main()
