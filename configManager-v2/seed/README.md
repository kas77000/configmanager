# Seed config

Place a starting `ai.fixmsg.properties` here to seed every instance branch on first run:

```
configManager-v2/seed/ai.fixmsg.properties
```

This file is **gitignored** (it mirrors the real trading config, which never belongs in the repo).
If it is absent, the app still starts and seeds each instance with a placeholder you can edit later.

To reset and re-seed from this file, run `python reset.py` and restart the app.
