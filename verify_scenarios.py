#!/usr/bin/env python3
"""Scenario and integrity verification runner for Dark Forest Finance Web App."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    print("=" * 65)
    print(" DARK FOREST FINANCE — AUTOMATED WEB APP VERIFICATION")
    print("=" * 65)
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    print("=" * 65)
    if result.wasSuccessful():
        print("ALL WEB APP CHECKS VERIFIED SUCCESSFULLY.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
