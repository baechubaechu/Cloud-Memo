# Cloud Memo (Personal Self-Host)

옵시디언 풍 마크다운 에디터를 가진 **개인 클라우드 메모**입니다.  
한 사용자(=한 인스턴스)를 전제로 설계되었으며, 다음 두 가지 배포 형태를 모두 지원합니다.

| 모드 | DB 위치 | 외부 접근 | 권장 사용처 |
|---|---|---|---|
| **VPS 모드** | 본인 VPS | 도메인 + 자동 HTTPS | 외부에서 항상 접근, 24/7 가동 |
| **로컬 모드** | 본인 PC/NAS | 로컬 LAN | PC가 켜져 있을 때만 접근, 무료/사적 |

> **중요**: 이 앱은 SaaS가 아닙니다. 사용자는 각자 자기 인스턴스를 띄워 자기 DB를 가집니다.  
> 다른 사람의 데이터가 당신 인스턴스로 들어오지 않습니다(반대도 마찬가지).

## 스택

- 프런트: Next.js 15 (App Router) + React 19 + Tailwind + CodeMirror 6 + PWA
- 백엔드: FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2
- DB: PostgreSQL 16
- 리버스 프록시: Caddy 2 (자동 HTTPS)
- 인증: 단일 비밀번호 잠금 해제 (JWT 토큰 기반 세션)

## 디렉터리 구조

```
cloud-memo/
├── docker-compose.yml         # memo-postgres / memo-api / memo-web / memo-worker / caddy
├── .env.example               # 인스턴스마다 복사 → .env 로 사용
├── caddy/Caddyfile            # /api/* → memo-api, 그 외 → memo-web (+ 보안 헤더)
├── api/                       # FastAPI
├── web/                       # Next.js
├── worker/                    # AI 워커 (placeholder)
├── scripts/                   # PowerShell 개발 스크립트
└── data/                      # 호스트 마운트 (DATA_DIR)
    ├── postgres/              # DB 영속 볼륨
    └── uploads/               # 첨부파일 (이미지/오디오/일반파일/썸네일)
```

## 빠른 시작 — 모드별 가이드

### A. VPS 모드 (본인 VPS에 자기 인스턴스 띄우기)

VPS에 Docker + Docker Compose가 설치되어 있다고 가정합니다.

```bash
git clone <this repo> /opt/cloud-memo
cd /opt/cloud-memo
cp .env.example .env

# 다음 4개는 반드시 직접 수정한 후 컨테이너 띄우세요.
#  - APP_ENV=production
#  - JWT_SECRET=<32자 이상 랜덤 문자열>
#  - INITIAL_USER_PASSWORD=<자기만 아는 비번>
#  - DOMAIN=memo.example.com   # 본인이 보유한 도메인
nano .env

docker compose up -d --build
```

위 4가지가 빠지면 컨테이너가 의도적으로 시작되지 않습니다 (사고 방지).
브라우저로 `https://memo.example.com` 으로 접속 → 1단계: 비밀번호 입력 → 끝.

`JWT_SECRET` 은 다음 한 줄로 만들 수 있습니다.
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### B. 로컬 모드 (자기 PC/NAS에서 띄우고 같은 네트워크에서 접근)

PC에 Docker가 있으면 동일하게:
```bash
cp .env.example .env
# .env 에서 APP_ENV 는 development 로 두고, INITIAL_USER_PASSWORD 만 바꾸기
docker compose up -d --build
```
- 로컬 PC: `http://localhost`
- 같은 LAN의 폰/태블릿: `http://<PC의 LAN IP>` 로 접근 가능 (Caddy 80 포트)
- PC가 꺼져 있으면 다른 기기에서도 접근 불가 (= 의도된 동작)

#### 더 가벼운 로컬 개발 (Docker 없이 코드만 빠르게 고치고 싶을 때)

평소 작업은 Postgres 컨테이너 + 백엔드/프런트 직접 실행이 빠릅니다.

**권장: 한 번에** — Docker Desktop 을 켠 뒤 레포 루트에서:

```powershell
# 사전 준비 (1회)
cd api;  python -m venv .venv;  .\.venv\Scripts\python -m pip install -r requirements.txt;  cd ..
cd web;  npm install;  cd ..

# 평소 — Postgres 기동 → API 는 새 창 → 이 창에서 Next (:3000)
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1
```

`dev-all.ps1` 은 `memo-postgres` 를 띄우고 healthy 될 때까지 기다린 뒤, **:8000** 이 비어 있으면 `dev-api.ps1` 을 **별도 PowerShell 창**에서 실행하고, `/api/health` 가 될 때까지 기다린 다음 **현재 창**에서 `dev-web.ps1`(Next) 을 띄웁니다. API 를 안 켠 채 웹만 열어 `Failed to fetch` 가 나는 상황을 줄이기 위한 스크립트입니다.

**수동으로 나누고 싶을 때** (터미널 2개):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1   # Postgres만 (선택)
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-api.ps1  # FastAPI :8000
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-web.ps1  # Next.js :3000
```

기본 잠금 비밀번호: `1234` (`scripts/dev-api.ps1` 가 환경변수로 주입).
dev-web 시작 시 로그인 화면이 비번을 자동입력하므로 곧장 `/memo` 진입.

작업 종료:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
```

## 환경 변수 한눈에

| 변수 | 의미 | 기본값 |
|---|---|---|
| `APP_ENV` | `production` 이면 약한 기본값 사용 시 API 시작 차단 | `development` |
| `DATA_DIR` | 호스트의 데이터 루트 (DB / uploads) | `./data` |
| `JWT_SECRET` | 토큰 서명용 시크릿. **운영은 32자 이상** | `dev-change-me` |
| `INITIAL_USER_PASSWORD` | 잠금 해제 비밀번호 (DB 비어있을 때 1회 부트스트랩) | `1234` |
| `INITIAL_USER_EMAIL` | 내부 식별자(로그인엔 안 씀, 호환용) | `admin@localhost` |
| `CORS_ORIGINS` | 허용 origin 콤마 목록. 와일드카드 금지 | localhost |
| `NEXT_PUBLIC_API_URL` | 프런트 빌드 시 API 주소 | `http://localhost:8000` |
| `MAX_UPLOAD_MB` | 첨부파일 1개 최대 크기 | `25` |
| `VERSION_AUTOSAVE_MIN_SECONDS` | 자동 스냅샷 최소 간격 | `120` |
| `DOMAIN` | Caddy가 잡을 호스트명. 진짜 도메인이면 자동 HTTPS | `localhost` |

## 운영/유틸 스크립트

| 스크립트 | 용도 | 예시 |
|---|---|---|
| `scripts/dev-all.ps1` | 로컬 풀스택: Postgres(Docker) → API(새 창) → Web(현재 창), health 대기 | `powershell -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1` |
| `scripts/deploy-vps.sh` | VPS에서 안전 점검 후 `docker compose up -d --build` 실행 | `bash ./scripts/deploy-vps.sh` |
| `scripts/change-password.sh` | 잠금 비밀번호 변경 (docker/local/auto) | `bash ./scripts/change-password.sh --new-password "newpass"` |
| `scripts/change-password.ps1` | 잠금 비밀번호 변경 (Windows) | `powershell -ExecutionPolicy Bypass -File .\scripts\change-password.ps1 -NewPassword "newpass"` |
| `scripts/dev-firewall.ps1` | Windows 개발용 방화벽 인바운드(3000/8000) 등록 | `powershell -ExecutionPolicy Bypass -File .\scripts\dev-firewall.ps1` |

## 인증 — 단일 비밀번호 잠금

- 회원가입/멀티 사용자 개념 없음.
- DB의 첫 사용자(부트스트랩으로 만들어진) 1명에 대한 비밀번호만 검증.
- 프런트 로그인 화면은 비밀번호 입력 1필드.
- 토큰은 클라이언트(localStorage)에 저장, 서버는 stateless JWT.

비밀번호를 바꾸려면 환경변수 `INITIAL_USER_PASSWORD` 를 바꿔도 **이미 부트스트랩된 인스턴스에는 적용되지 않습니다.** 다음 중 하나를 사용하세요.

```bash
# 컨테이너 안에서 (운영)
docker compose exec memo-api python -c "from app.database import SessionLocal; from app.models import User; from app.security import hash_password; from sqlalchemy import select; \
db=SessionLocal(); u=db.execute(select(User)).scalar_one(); u.hashed_password=hash_password('새비번'); db.commit(); print('done')"
```

```powershell
# 로컬 venv (개발)
cd api; .\.venv\Scripts\python -c "from app.database import SessionLocal; from app.models import User; from app.security import hash_password; from sqlalchemy import select; db=SessionLocal(); u=db.execute(select(User)).scalar_one(); u.hashed_password=hash_password('새비번'); db.commit()"
```

## 데이터 저장 위치

| 종류 | 위치 |
|---|---|
| 메모 본문 / 메타 / 태그 / 폴더 | Postgres `memo` 데이터베이스 |
| 이미지·오디오·일반 첨부 | `data/uploads/{kind}/{note_id}/...` |
| 썸네일 (이미지) | `data/uploads/thumbnails/{note_id}/...` |
| Markdown export 임시 | 메모리 (.zip 스트리밍) |
| Postgres 자체 | `data/postgres/` |

백업하려면 **`data/` 통째로** 스냅샷 + `pg_dump`(권장) 둘 다 돌리세요.

## 핵심 기능

| 항목 | 상태 |
|---|---|
| 단일 비밀번호 잠금 | ✅ 토큰 기반 세션 |
| 메모 CRUD | ✅ |
| 자동 저장 (debounce 900ms) | ✅ |
| 옵시디언 풍 라이브 마크다운 | ✅ 현재 줄은 원문, 그 외는 렌더 |
| 폴더 / 태그 | ✅ 드래그앤드롭 이동 |
| 즐겨찾기 / 아카이브 | ✅ |
| 영구 삭제 (확인 모달) | ✅ |
| 버전 히스토리 | ✅ manual / before_delete / before_ai_edit / restore / periodic_autosave |
| 검색 (제목·본문·태그·첨부 파일명) | ✅ ILIKE + pg_trgm 인덱스 |
| 이미지 첨부 + 썸네일 | ✅ Pillow 480px 자동 |
| 저장소 사용량 | ✅ `/api/storage/usage` |
| Markdown 일괄 export (.zip) | ✅ |
| PWA (홈 화면에 설치) | ✅ HTTPS 도메인일 때 |

## API 요약

```
POST   /api/auth/login          POST /api/auth/logout    GET /api/auth/me
GET    /api/folders             POST /api/folders        PATCH /api/folders/{id}    DELETE /api/folders/{id}
GET    /api/tags                POST /api/tags           DELETE /api/tags/{id}
GET    /api/notes               POST /api/notes
GET    /api/notes/{id}          PATCH /api/notes/{id}    DELETE /api/notes/{id}
GET    /api/notes/{id}/versions POST  /api/notes/{id}/versions
POST   /api/notes/{id}/restore-version/{version_id}
POST   /api/notes/{id}/attachments
DELETE /api/attachments/{id}
GET    /api/attachments/{id}/download · /thumbnail
GET    /api/search?q=
GET    /api/storage/usage
GET    /api/export/manifest · /api/export/markdown
GET    /api/ai-jobs · POST · GET/{id} · PATCH/{id}
```

## 보안 / 운영 체크리스트 (배포 전)

- [ ] `APP_ENV=production`
- [ ] `JWT_SECRET` 32자 이상의 새 랜덤
- [ ] `INITIAL_USER_PASSWORD` 강한 비밀번호로 변경
- [ ] `DOMAIN=memo.example.com` (도메인 보유 시 자동 HTTPS)
- [ ] `CORS_ORIGINS` 에 와일드카드(`*`) 없이 실제 origin만
- [ ] `data/` 정기 백업 (`pg_dump` + `data/uploads/` rsync)
- [ ] Next.js / FastAPI 보안 패치 정기 업데이트

## 라이선스

MIT — 자세한 사항은 [LICENSE](./LICENSE), 의존성 라이선스는 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
