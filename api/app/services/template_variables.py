"""Expand literal template variables without executing user code."""
import re
from datetime import datetime


def render_template(text: str, title: str, now: datetime) -> str:
    values = {"title": title, "date": now.strftime("%Y-%m-%d"), "time": now.strftime("%H:%M")}
    return re.sub(r"\{\{(title|date|time)\}\}", lambda match: values[match[1]], text)
