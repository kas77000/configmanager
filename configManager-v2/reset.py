"""Reset the app's data from the command line. Mirrors the original `npm run reset`.

Usage:
  python reset.py                 # wipe everything (data/)
  python reset.py users           # clear only the users (re-arms admin bootstrap)
  python reset.py changes audit   # clear one or more stores

Targets: users | instances | changes | settings | audit | repo | live | all
  - "repo" clears both the built-in store (repo.json) and the git repo (config-repo/).
  - Each cleared store is re-created (re-seeded) on the next app start.

NOTE: Streamlit keeps the Store in memory (@st.cache_resource), so this CLI only takes
effect once the app is restarted — stop it (Ctrl+C) and run `streamlit run streamlit_app.py`
again. A browser reload alone is not enough. To reset a *running* app without a restart,
use Admin → Reset data instead.
"""
import os
import shutil
import stat
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
# Each target maps to the path(s) it removes, relative to data/.
FILES = {
    "users": ["users.json"],
    "instances": ["instances.json"],
    "changes": ["changes.json"],
    "settings": ["settings.json"],
    "audit": ["audit.json"],
    "live": ["live.json"],
    "repo": ["repo.json", "config-repo"],  # built-in store + git repo
}


def _force_rmtree(path: Path) -> None:
    """Remove a tree even when git leaves read-only pack files behind (Windows)."""
    def on_error(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)
    shutil.rmtree(path, onerror=on_error)


def _remove(path: Path, label: str) -> None:
    if not path.exists():
        print(f"  (already absent) {label}")
        return
    if path.is_dir():
        _force_rmtree(path)
    else:
        path.unlink()
    print(f"  removed {label}")


def main(argv):
    targets = argv or ["all"]
    if not DATA.exists():
        print(f"Nothing to reset — no data directory at {DATA}")
        return

    print(f"Resetting Configuration Manager data in {DATA}")
    if "all" in targets:
        _force_rmtree(DATA)
        print("  removed data/ (everything)")
    else:
        unknown = [t for t in targets if t not in FILES]
        if unknown:
            print(f"Unknown target(s): {', '.join(unknown)}")
            print(f"Valid targets: all, {', '.join(FILES)}")
            sys.exit(1)
        for t in targets:
            for rel in FILES[t]:
                _remove(DATA / rel, f"data/{rel}")
    print("Done. Restart the app (stop it and re-run streamlit) to pick up the reset.")


if __name__ == "__main__":
    main(sys.argv[1:])
