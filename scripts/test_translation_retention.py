import os
import sys
import types
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")
os.environ.setdefault("DEEPSEEK_API_KEY", "test-key")

openai_stub = types.ModuleType("openai")
openai_stub.OpenAI = lambda *args, **kwargs: object()
sys.modules.setdefault("openai", openai_stub)

supabase_stub = types.ModuleType("supabase")
supabase_stub.create_client = lambda *args, **kwargs: object()
sys.modules.setdefault("supabase", supabase_stub)

import translate


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class TranslationRetentionTests(unittest.TestCase):
    def test_complete_translation_requires_chinese_title_and_abstract(self):
        article = {
            "is_translated": True,
            "title_zh": "幼儿学习研究",
            "abstract_original": "An English abstract.",
            "abstract_zh": "这是一段中文摘要。",
        }
        self.assertTrue(translate.translation_is_complete(article))

        article["abstract_zh"] = None
        self.assertFalse(translate.translation_is_complete(article))

        article["abstract_zh"] = "Still English."
        self.assertFalse(translate.translation_is_complete(article))

    def test_english_title_is_not_accepted_as_translated(self):
        article = {
            "is_translated": True,
            "title_zh": "Still an English title",
            "abstract_original": None,
            "abstract_zh": None,
        }
        self.assertFalse(translate.translation_is_complete(article))

    def test_chinese_prefix_does_not_hide_an_untranslated_english_abstract(self):
        article = {
            "is_translated": True,
            "title_zh": "幼儿学习研究",
            "abstract_original": "A complete English abstract about early learning.",
            "abstract_zh": "摘要：A complete English abstract about early learning.",
        }
        self.assertFalse(translate.translation_is_complete(article))

    def test_retention_migration_protects_saved_articles(self):
        migration = (
            PROJECT_ROOT
            / "supabase/migrations/20260729160000_add_saved_articles_retention.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("not exists", migration.lower())
        self.assertIn("public.user_saved_articles", migration)
        self.assertIn("greatest(30", migration.lower())
        self.assertIn("least(coalesce(p_max_delete, 200), 1000)", migration.lower())

    def test_cleanup_rpc_is_not_executable_by_frontend_roles(self):
        migration = (
            PROJECT_ROOT
            / "supabase/migrations/20260729170000_harden_cleanup_rpc_permissions.sql"
        ).read_text(encoding="utf-8")
        normalized = " ".join(migration.lower().split())
        self.assertIn("from public, anon, authenticated", normalized)
        self.assertIn("to service_role", normalized)

    def test_scoped_cleanup_rpc_requires_a_hashed_token(self):
        migration = (
            PROJECT_ROOT
            / "supabase/migrations/20260729190000_add_scoped_cleanup_token.sql"
        ).read_text(encoding="utf-8")
        normalized = " ".join(migration.lower().split())
        self.assertIn("extensions.digest(p_cleanup_token, 'sha256')", normalized)
        self.assertIn("invalid cleanup credential", normalized)
        self.assertNotIn("article_cleanup_token", migration.lower())


if __name__ == "__main__":
    unittest.main()
