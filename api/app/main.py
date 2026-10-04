from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import assert_production_safe, settings
from app.routers import ai_jobs, attachments, auth, exports, folders, notes, search, storage, sync, tags

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


@app.middleware("http")
async def no_store_api_responses(request, call_next):
    """노트·첨부 응답이 브라우저의 HTTP 캐시(디스크)에 남지 않게 한다.

    기기에 무엇을 남길지는 클라이언트의 암호화 보관소만 결정한다.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


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
app.include_router(sync.router, prefix="/api")
