# Cloud Memo (Personal Self-Host)

옵시디언 풍 마크다운 에디터를 가진 **개인 메모**입니다.  
한 사용자(=한 인스턴스)를 전제로 하며, **벤더 메모 SaaS가 아닙니다.** 데이터는 사용자가 통제하는 VPS·집 허브·PC에만 둡니다.

**배포 프로필:** [`deploy/README.md`](./deploy/README.md) — VPS / 집 허브(저전력) / 데스크톱 로컬 / 본인 클라우드 VM

| 모드 | 문서 | 요약 |
|---|---|---|
| **VPS** | [deploy/vps](./deploy/vps/) | 도메인 + HTTPS, 24/7 |
| **집 허브** | [deploy/hub](./deploy/hub/) | Pi·NAS, Tailscale 권장 |
| **데스크톱** | [deploy/desktop-local](./deploy/desktop-local/) | 개발·PC 허브 |
| **클라우드 VM** | [deploy/cloud](./deploy/cloud/) | Lightsail·Hetzner 등 **본인 VM** |

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
├── deploy/                    # 배포 프로필 (VPS / hub / desktop-local / cloud)
├── docker-compose.yml         # 루트 compose (개발·호환)
├── .env.example
├── caddy/Caddyfile            # /api/* → memo-api, 그 외 → memo-web (+ 보안 헤더)
├── api/                       # FastAPI
├── web/                       # Next.js
├── worker/                    # AI 워커 (placeholder)
├── scripts/                   # PowerShell 개발 스크립트
└── data/                      # 호스트 마운트 (DATA_DIR)
    ├── postgres/              # DB 영속 볼륨
    └── uploads/               # 첨부파일 (이미지/오디오/일반파일/썸네일)
```

## 빠른 시작

상세는 **[`deploy/README.md`](./deploy/README.md)** 를 보세요.

### VPS (본인 서버 + 도메인)

```bash
git clone https://github.com/baechubaechu/Cloud-Memo.git /opt/cloud-memo
cd /opt/cloud-memo
cp deploy/vps/.env.example deploy/vps/.env
nano deploy/vps/.env
bash deploy/vps/setup.sh
```

### 집 허브 (라즈베리 파이 / NAS)

```bash
cp deploy/hub/.env.example deploy/hub/.env
nano deploy/hub/.env
bash deploy/hub/setup.sh
```

### 로컬 개발 (Windows)

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1
```

→ [`deploy/desktop-local/README.md`](./deploy/desktop-local/README.md)

### 레거시: 루트 compose

```bash
cp .env.example .env
docker compose up -d --build
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
| `DOMAIN` | Caddy가 잡을 호스트명. 진짜 도메인이면 자동 HTTPS | `localhost` |

## 운영/유틸 스크립트

| 스크립트 | 용도 | 예시 |
|---|---|---|
| `scripts/dev-all.ps1` | 로컬 풀스택: Postgres(Docker) → API(새 창) → Web(현재 창), health 대기 | `powershell -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1` |
| `scripts/deploy-vps.sh` | VPS 배포 (`deploy/vps/setup.sh` 위임) | `bash ./scripts/deploy-vps.sh` |
| `scripts/change-password.sh` | 잠금 비밀번호 변경 (docker/local/auto) | `bash ./scripts/change-password.sh --new-password "newpass"` |
| `scripts/change-password.ps1` | 잠금 비밀번호 변경 (Windows) | `powershell -ExecutionPolicy Bypass -File .\scripts\change-password.ps1 -NewPassword "newpass"` |
| `scripts/dev-firewall.ps1` | Windows 개발용 방화벽 인바운드(3000/8000) 등록 | `powershell -ExecutionPolicy Bypass -File .\scripts\dev-firewall.ps1` |

## 인증 — 단일 비밀번호 잠금

- 회원가입/멀티 사용자 개념 없음.
- DB의 첫 사용자(부트스트랩으로 만들어진) 1명에 대한 비밀번호만 검증.
- 프런트 로그인 화면은 비밀번호 입력 1필드.
- 토큰은 클라이언트(localStorage)에 저장, 서버는 stateless JWT.
- 노트 사본은 기본적으로 기기에 남기지 않는다. 로그인 화면에서 「이 기기에 노트 보관」 을
  켠 기기에서만 암호화해 저장하며(오프라인 사용), 그 기기는 열 때마다 비밀번호를 묻는다.

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
| 버전 히스토리 | ✅ 편집 중 1시간마다 + 병합 직전 자동 스냅샷, 7일 보관, 되돌리기 |
| 검색 (제목·본문·태그·첨부 파일명) | ✅ ILIKE + pg_trgm 인덱스 |
| 이미지 첨부 + 썸네일 | ✅ Pillow 480px 자동 |
| 저장소 사용량 | ✅ `/api/storage/usage` |
| Markdown 일괄 export (.zip) | ✅ |
| PWA (홈 화면에 설치) | ✅ HTTPS 도메인일 때 |
| 여러 기기 동기화 | ✅ 3초 폴링 + 서버 자동 병합 |
| 오프라인 편집 | 🟡 보관을 켠 기기에서 노트 열기·편집, 연결되면 반영 (새 노트·삭제·첨부는 예정) |
| 기기 보관 | ✅ 기본 꺼짐. 켠 기기에서만 암호화해 저장, 로그아웃 시 삭제 |

## API 요약

```
POST   /api/auth/login          POST /api/auth/logout    GET /api/auth/me
GET    /api/folders             POST /api/folders        PATCH /api/folders/{id}    DELETE /api/folders/{id}
GET    /api/tags                POST /api/tags           DELETE /api/tags/{id}
GET    /api/notes               POST /api/notes
GET    /api/notes/{id}          PATCH /api/notes/{id}    DELETE /api/notes/{id}
GET    /api/notes/{id}/versions
POST   /api/notes/{id}/restore-version/{version_id}
POST   /api/notes/{id}/attachments
DELETE /api/attachments/{id}
GET    /api/attachments/{id}/download · /thumbnail
GET    /api/sync/changes?since=   (다른 기기의 변경 폴링)
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
