"""Deterministic backend template expansion tests (standard library only)."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))
from app.services.template_variables import render_template

now = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
assert render_template("{{title}} / {{date}} / {{time}}", "Daily", now) == "Daily / 2026-01-02 / 03:04"
assert render_template("{{title}} {{title}}", "$& {{date}}", now) == "$& {{date}} $& {{date}}"
assert render_template("{{unknown}} {{date:YY}} <% unsafe %>", "Daily", now) == "{{unknown}} {{date:YY}} <% unsafe %>"
assert render_template("{{date}} {{time}}", "Daily", now.astimezone(timezone(timedelta(hours=-8)))) == "2026-01-01 19:04"
print("PASS: backend template variables, literal substitutions, unknown syntax, timezone rollover")
