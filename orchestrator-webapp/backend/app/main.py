from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.core import router as core_router
from app.api.events import router as events_router
from app.api.ext import router as ext_router

app = FastAPI(title="Orchestrator WebApp API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(core_router)
app.include_router(ext_router)
app.include_router(events_router)


@app.get("/")
def root() -> dict:
    return {"name": "orchestrator-webapp", "status": "ok"}
