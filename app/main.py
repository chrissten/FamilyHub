from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.routers import auth, calendar, grocery, todo, users
from app.seed import seed_admin

app = FastAPI(title="FamilyHub")

app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(calendar.router)
app.include_router(grocery.router)
app.include_router(todo.router)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()


@app.get("/")
def root():
    return RedirectResponse(url="/grocery")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
