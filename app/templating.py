import os
from datetime import date, datetime, timedelta

from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")

_css_path = os.path.join("app", "static", "css", "app.css")
templates.env.globals["asset_version"] = str(int(os.path.getmtime(_css_path)))


def fmt_time(dt: datetime) -> str:
    hour12 = dt.hour % 12 or 12
    period = "AM" if dt.hour < 12 else "PM"
    return f"{hour12}:{dt.minute:02d} {period}"


def expiry_class(exp_date: date | None) -> str:
    if exp_date is None:
        return ""
    today = date.today()
    if exp_date < today:
        return "expired"
    if exp_date <= today + timedelta(days=7):
        return "expiring-soon"
    return ""


templates.env.filters["fmt_time"] = fmt_time
templates.env.filters["expiry_class"] = expiry_class
