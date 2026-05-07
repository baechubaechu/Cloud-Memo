from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import assert_production_safe, settings
from app.routers import ai_jobs, attachments, auth, exports, folders, notes, search, storage, tags

# APP_ENV=production 일 때 약한 기본값(JWT_SECRET 등)을 fail-fast 로 잡아낸다.
assert_production_safe()

app = FastAPI(title="Cloud Memo API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(folders.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(attachments.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(storage.router, prefix="/api")
app.include_router(exports.router, prefix="/api")
app.include_router(ai_jobs.router, prefix="/api")
