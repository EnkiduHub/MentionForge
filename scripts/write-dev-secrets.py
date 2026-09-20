#!/usr/bin/env python3
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sandbox = secrets.token_urlsafe(32)
operator = secrets.token_urlsafe(32)
(root / ".dev.vars").write_text(f"SANDBOX_KEY={sandbox}\nOPERATOR_TOKEN={operator}\n")
(root / ".secrets-tmp-sandbox").write_text(sandbox)
(root / ".secrets-tmp-operator").write_text(operator)
print("wrote .dev.vars")
