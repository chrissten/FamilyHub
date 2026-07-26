from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from sqlalchemy import inspect, text

from app.database import Base, SessionLocal, engine
from app.models import CalendarEvent
from app.recurrence import top_up_recurring_series
from app.routers import auth, calendar, freezer, grocery, todo, users
from app.seed import seed_admin
from app.timezones import to_utc

app = FastAPI(title="FamilyHub")

app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.exception_handler(HTTPException)
async def redirect_unauthenticated_browsers_to_login(request: Request, exc: HTTPException):
    if exc.status_code == 401 and "text/html" in request.headers.get("accept", ""):
        return RedirectResponse(url="/login")
    return await http_exception_handler(request, exc)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(calendar.router)
app.include_router(grocery.router)
app.include_router(todo.router)
app.include_router(freezer.router)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    # Add sort_order to grocery_items if this is an existing deployment
    cols = [c["name"] for c in inspect(engine).get_columns("grocery_items")]
    if "sort_order" not in cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE grocery_items ADD COLUMN sort_order INTEGER DEFAULT 0"))
            conn.commit()
    # Add recurrence columns to calendar_events if this is an existing deployment
    event_cols = [c["name"] for c in inspect(engine).get_columns("calendar_events")]
    with engine.connect() as conn:
        if "recurrence_rule" not in event_cols:
            conn.execute(text("ALTER TABLE calendar_events ADD COLUMN recurrence_rule VARCHAR(200)"))
        if "series_id" not in event_cols:
            conn.execute(text("ALTER TABLE calendar_events ADD COLUMN series_id VARCHAR(36)"))
        if "series_until" not in event_cols:
            conn.execute(text("ALTER TABLE calendar_events ADD COLUMN series_until DATE"))
        if "timezone" not in event_cols:
            conn.execute(text("ALTER TABLE calendar_events ADD COLUMN timezone VARCHAR(64)"))
        if "end_timezone" not in event_cols:
            # NULL means "same as `timezone`" (see CalendarEvent.end_timezone) — no backfill
            # needed, existing rows are already correct under that fallback.
            conn.execute(text("ALTER TABLE calendar_events ADD COLUMN end_timezone VARCHAR(64)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_calendar_events_series_id ON calendar_events (series_id)"))
        conn.commit()
    if "timezone" not in event_cols:
        # One-time backfill: existing start_time/end_time were naive wall-clock values
        # with no real timezone semantics. Reinterpret them as wall clock in
        # settings.default_timezone and rewrite as true UTC instants. All-day events are
        # untouched — they're pure date boundaries, never timezone-converted.
        db = SessionLocal()
        try:
            for event in db.query(CalendarEvent).all():
                if event.all_day:
                    event.timezone = settings.default_timezone
                    continue
                naive_start = event.start_time.replace(tzinfo=None)
                naive_end = event.end_time.replace(tzinfo=None)
                event.start_time = to_utc(naive_start, settings.default_timezone)
                event.end_time = to_utc(naive_end, settings.default_timezone)
                event.timezone = settings.default_timezone
            db.commit()
        finally:
            db.close()
    # Add quantity_unit to freezer_items if this is an existing deployment
    freezer_item_cols = [c["name"] for c in inspect(engine).get_columns("freezer_items")]
    if "quantity_unit" not in freezer_item_cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE freezer_items ADD COLUMN quantity_unit VARCHAR(10)"))
            conn.commit()
    db = SessionLocal()
    try:
        seed_admin(db)
        top_up_recurring_series(db)
    finally:
        db.close()


@app.get("/")
def root():
    return RedirectResponse(url="/grocery")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
