"""Reset the app's data. Mirrors the original `npm run reset`.

Usage:
  python reset.py                 # wipe everything (data/)
  python reset.py users           # clear only the users (re-arms admin bootstrap)
  python reset.py changes audit   # clear one or more stores

Targets: users | instances | changes | settings | audit | repo | live | all
Each cleared store is re-created (re-seeded) on the next app start.
"""
import shutil
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
FILES = {
    "users": "users.json", "instances": "instances.json", "changes": "changes.json",
    "settings": "settings.json", "audit": "audit.json", "repo": "repo.json", "live": "live.json",
}


def main(argv):
    targets = argv or ["all"]
    if "all" in targets:
        if DATA.exists():
            shutil.rmtree(DATA)
        print(f"Removed {DATA}")
        return
    for t in targets:
        name = FILES.get(t)
        if not name:
            print(f"Unknown target: {t} (valid: {', '.join(FILES)} , all)")
            continue
        p = DATA / name
        if p.exists():
            p.unlink()
            print(f"Cleared {name}")
        else:
            print(f"(already absent) {name}")


if __name__ == "__main__":
    main(sys.argv[1:])
