import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")


class DummySupabaseClient:
    pass


requests_stub = types.ModuleType("requests")
requests_stub.get = lambda *args, **kwargs: None
sys.modules.setdefault("requests", requests_stub)

feedparser_stub = types.ModuleType("feedparser")
feedparser_stub.parse = lambda *args, **kwargs: types.SimpleNamespace(entries=[])
sys.modules.setdefault("feedparser", feedparser_stub)

supabase_stub = types.ModuleType("supabase")
supabase_stub.create_client = lambda *args, **kwargs: DummySupabaseClient()
sys.modules.setdefault("supabase", supabase_stub)

import backfill_2026
import fetch_journals


PROJECT_ROOT = Path(__file__).resolve().parents[1]

INTERNATIONAL_JOURNALS = {
    "Early Childhood Research Quarterly",
    "Child Development",
    "Child Development Perspectives",
    "Early Childhood Education Journal",
    "Early Education and Development",
    "Journal of Early Childhood Literacy",
    "Infant and Child Development",
    "European Early Childhood Education Research Journal",
    "Early Child Development and Care",
    "Early Years",
    "Infant Behavior & Development",
}

DOMESTIC_JOURNALS = {
    "学前教育研究",
    "心理发展与教育",
    "教师教育研究",
    "比较教育研究",
}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        return None


class JournalSourceTests(unittest.TestCase):
    def test_requested_journals_are_in_all_runtime_configs(self):
        daily_international = {item["name"] for item in fetch_journals.OPENALEX_JOURNALS}
        daily_domestic = {item["name"] for item in fetch_journals.OPENALEX_DOMESTIC_JOURNALS}
        backfill = {item["name"] for item in backfill_2026.JOURNALS}

        self.assertTrue(INTERNATIONAL_JOURNALS <= daily_international)
        self.assertTrue(DOMESTIC_JOURNALS <= daily_domestic)
        self.assertTrue((INTERNATIONAL_JOURNALS | DOMESTIC_JOURNALS) <= backfill)

        config_path = PROJECT_ROOT / "web/src/config/core-journals.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        frontend_international = set(config["global"]) | set(config["international"])
        frontend_domestic = set(config["global"]) | set(config["domestic"])
        self.assertTrue(INTERNATIONAL_JOURNALS <= frontend_international)
        self.assertTrue(DOMESTIC_JOURNALS <= frontend_domestic)

    def test_exact_source_name_wins_over_first_search_result(self):
        response = FakeResponse({
            "results": [
                {"id": "S-wrong", "display_name": "International Journal of Early Years Education"},
                {"id": "S-right", "display_name": "Early Years"},
            ]
        })
        with patch.object(fetch_journals.requests, "get", return_value=response):
            self.assertEqual(fetch_journals.get_openalex_journal_id("Early Years"), "S-right")

    def test_null_title_is_skipped_without_aborting_fetch(self):
        response = FakeResponse({
            "results": [
                {
                    "title": None,
                    "abstract_inverted_index": None,
                    "doi": None,
                    "publication_date": "2026-07-01",
                    "primary_location": None,
                    "authorships": [],
                },
                {
                    "title": "A valid early childhood study",
                    "abstract_inverted_index": None,
                    "doi": "https://doi.org/10.1000/example",
                    "publication_date": "2026-07-02",
                    "primary_location": None,
                    "authorships": [],
                },
            ]
        })
        journal = {
            "name": "Example Journal",
            "module": "research_frontier",
            "region": "international",
            "filter": None,
            "openalex_id": "S-example",
        }

        with patch.object(fetch_journals.requests, "get", return_value=response), patch.object(
            fetch_journals, "classify_topics", return_value=[]
        ):
            articles = fetch_journals.fetch_openalex_papers(journal)

        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["title_original"], "A valid early childhood study")


if __name__ == "__main__":
    unittest.main()
