"""Fetches the pinned tectonic binary used to compile LaTeX resumes to PDF.

tectonic is a Rust binary, not a Python package — there is nothing for
requirements.txt to pin, so the version lives here instead, as a constant.
Re-running this script is how you move to a newer tectonic deliberately;
nothing auto-updates it.

Installs to backend/.tools/ (gitignored — see .gitignore) rather than onto
system PATH, so a dev machine or CI runner doesn't need admin rights and two
projects can't fight over a global install. app/modules/resume_builder/latex.py
resolves the binary by checking PATH first, then this directory — so a
production image that installs tectonic via its OS package manager works
without any change here.

Usage:
    python scripts/install_tectonic.py
"""

import os
import platform
import shutil
import stat
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# Bump deliberately — this pins what every dev machine and CI runner installs.
VERSION = "0.17.0"
RELEASE_TAG = f"tectonic%40{VERSION}"  # '@' is a valid tag char but must be
# percent-encoded in the release-asset URL path.

TOOLS_DIR = Path(__file__).resolve().parent.parent / ".tools"

# (platform.system(), platform.machine()) -> (asset filename, archive kind, binary name in archive)
_ASSETS = {
    ("Windows", "AMD64"): ("tectonic-{v}-x86_64-pc-windows-msvc.zip", "zip", "tectonic.exe"),
    ("Linux", "x86_64"): ("tectonic-{v}-x86_64-unknown-linux-gnu.tar.gz", "tar", "tectonic"),
    ("Darwin", "x86_64"): ("tectonic-{v}-x86_64-apple-darwin.tar.gz", "tar", "tectonic"),
    ("Darwin", "arm64"): ("tectonic-{v}-aarch64-apple-darwin.tar.gz", "tar", "tectonic"),
}


def _resolve_asset() -> tuple[str, str, str]:
    key = (platform.system(), platform.machine())
    if key not in _ASSETS:
        supported = ", ".join(f"{s}/{m}" for s, m in _ASSETS)
        raise SystemExit(f"No tectonic build known for {key[0]}/{key[1]}. Supported: {supported}")
    filename_tpl, kind, binary_name = _ASSETS[key]
    return filename_tpl.format(v=VERSION), kind, binary_name


def _target_binary_path(binary_name: str) -> Path:
    return TOOLS_DIR / binary_name


def install() -> Path:
    filename, kind, binary_name = _resolve_asset()
    target = _target_binary_path(binary_name)

    if target.exists():
        print(f"tectonic already present at {target}")
        return target

    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/tectonic-typesetting/tectonic/releases/download/{RELEASE_TAG}/{filename}"
    print(f"Downloading {url}")

    with tempfile.TemporaryDirectory() as tmpdir:
        archive_path = Path(tmpdir) / filename
        # Not attacker-controlled input — a hardcoded, versioned GitHub
        # release URL — so a plain urlopen is fine here (bandit flags any
        # urlopen(variable) by pattern; this one's argument has no user input).
        with urllib.request.urlopen(url, timeout=60) as resp, open(archive_path, "wb") as out:  # noqa: S310
            shutil.copyfileobj(resp, out)

        if kind == "zip":
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(TOOLS_DIR)
        else:
            with tarfile.open(archive_path) as tf:
                tf.extractall(TOOLS_DIR)  # noqa: S202 — trusted, pinned release archive

    if not target.exists():
        raise SystemExit(f"Extraction succeeded but {target} is missing — asset layout may have changed upstream.")

    if os.name != "nt":
        target.chmod(target.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    print(f"Installed tectonic {VERSION} -> {target}")
    return target


if __name__ == "__main__":
    binary = install()
    sys.exit(os.system(f'"{binary}" --version'))
