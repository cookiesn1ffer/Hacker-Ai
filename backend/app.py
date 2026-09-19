"""
Hacker-AI - self-hosted pentest workbench.

Run:  python app.py     (or: uvicorn app:app --reload)
Then open http://localhost:8000
"""
import os

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from db import init_db
from routers import chat, engagements, providers, reports, tools

app = FastAPI(title="Hacker-AI")

init_db()

app.include_router(engagements.router)
app.include_router(tools.router)
app.include_router(chat.router)
app.include_router(providers.router)
app.include_router(reports.router)

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


if __name__ == "__main__":
    # Bound to localhost only - this is a personal tool, not something to expose.
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
