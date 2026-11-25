"""Unit tests for Dark Forest Finance Web App structure and integrity."""

import json
import os
import unittest
from pathlib import Path


class TestDarkForestWebApp(unittest.TestCase):
    """Verifies that all files, manifest, PWA shell, and HTML structure are valid."""

    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parent.parent

    def test_required_files_exist(self):
        """All critical web app files must be present in the project root."""
        required = [
            "index.html",
            "app.js",
            "finance.js",
            "sw.js",
            "manifest.webmanifest",
            "icon.svg",
            "tests.html",
            "render.yaml",
            "README.md",
        ]
        for fname in required:
            file_path = self.root / fname
            self.assertTrue(
                file_path.is_file(),
                f"Missing required file: {fname} at {file_path}",
            )
            self.assertGreater(
                file_path.stat().st_size,
                0,
                f"File {fname} is unexpectedly empty",
            )

    def test_manifest_webmanifest_validity(self):
        """Web app manifest must be valid JSON with PWA properties."""
        manifest_path = self.root / "manifest.webmanifest"
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertIn("name", data)
        self.assertIn("short_name", data)
        self.assertEqual(data.get("display"), "standalone")
        self.assertIn("start_url", data)
        self.assertIn("icons", data)
        self.assertIsInstance(data["icons"], list)
        self.assertGreaterEqual(len(data["icons"]), 1)

    def test_index_html_structure(self):
        """index.html must contain standard HTML5 doctype, viewport, and script tags."""
        html_path = self.root / "index.html"
        content = html_path.read_text(encoding="utf-8")

        self.assertTrue(
            content.lower().startswith("<!doctype html"),
            "index.html must start with <!doctype html>",
        )
        self.assertIn('<meta charset="utf-8">', content.lower())
        self.assertIn('name="viewport"', content.lower())
        self.assertIn("finance.js", content)
        self.assertIn("app.js", content)

        # Ensure finance.js is imported before app.js
        idx_finance = content.find("finance.js")
        idx_app = content.find("app.js")
        self.assertNotEqual(idx_finance, -1, "finance.js not linked in index.html")
        self.assertNotEqual(idx_app, -1, "app.js not linked in index.html")
        self.assertLess(
            idx_finance,
            idx_app,
            "finance.js must be loaded before app.js",
        )

    def test_service_worker_configuration(self):
        """sw.js must define a versioned cache and the essential app shell assets."""
        sw_path = self.root / "sw.js"
        content = sw_path.read_text(encoding="utf-8")

        self.assertIn("CACHE_VERSION", content)
        self.assertIn("APP_SHELL", content)
        self.assertIn("./index.html", content)
        self.assertIn("./finance.js", content)
        self.assertIn("./app.js", content)
        self.assertIn("./manifest.webmanifest", content)

    def test_tests_html_suite_present(self):
        """tests.html must exist and reference the Finance testing engine."""
        tests_html = self.root / "tests.html"
        content = tests_html.read_text(encoding="utf-8")

        self.assertIn("finance.js", content)
        self.assertIn("toCents", content)
        self.assertIn("isValidDate", content)
        self.assertIn("validate", content)

    def test_render_yaml_deployment_config(self):
        """render.yaml must configure a static site deployment."""
        render_yaml = self.root / "render.yaml"
        content = render_yaml.read_text(encoding="utf-8")

        self.assertIn("type: web", content)
        self.assertIn("runtime: static", content)


if __name__ == "__main__":
    unittest.main()
