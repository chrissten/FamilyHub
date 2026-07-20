from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from sqlalchemy import inspect, text

from app.database import Base, SessionLocal, engine
from app.recurrence import top_up_recurring_series
from app.routers import auth, calendar, freezer, grocery, todo, users
from app.seed import seed_admin

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
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_calendar_events_series_id ON calendar_events (series_id)"))
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
