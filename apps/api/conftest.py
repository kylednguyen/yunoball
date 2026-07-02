"""Pytest bootstrap: make `app` (and the sibling workspace packages) importable
without relying on the editable installs (their .pth files can be skipped on
macOS when they carry the hidden file flag).
"""

from __future__ import annotations

import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _API_DIR.parent.parent

for path in (_API_DIR, _REPO_ROOT / "packages" / "db", _REPO_ROOT / "packages" / "ingest"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
