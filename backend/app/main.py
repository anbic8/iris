from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.routers import activities, prs, users, webdav
from app.services.watcher import start_watcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    observer = start_watcher()
    yield
    observer.stop()
    observer.join()


app = FastAPI(title="I.R.I.S.", version="1.0.0", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY, max_age=86400 * 7)

app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(activities.router, prefix="/api/activities", tags=["activities"])
app.include_router(prs.router, prefix="/api/prs", tags=["prs"])
app.include_router(webdav.router, prefix="/webdav", tags=["webdav"])

app.mount("/", StaticFiles(directory="/app/frontend", html=True), name="frontend")
