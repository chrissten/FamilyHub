from datetime import datetime

from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")


def fmt_time(dt: datetime) -> str:
    hour12 = dt.hour % 12 or 12
    period = "AM" if dt.hour < 12 else "PM"
    return f"{hour12}:{dt.minute:02d} {period}"


templates.env.filters["fmt_time"] = fmt_time
