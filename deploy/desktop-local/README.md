# 데스크톱 로컬 프로필

**개발** 또는 **PC를 허브로 켜 둘 때** 사용합니다.  
Docker는 **Postgres만** 띄우고, API·Next는 호스트에서 실행해 HMR·디버깅이 빠릅니다.

## Windows (권장)

```powershell
# 1회
cd api; python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt; cd ..
cd web; npm install; cd ..
cp deploy\desktop-local\.env.example deploy\desktop-local\.env

# 평소
powershell.exe -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1
```

- Web: http://localhost:3000  
- API: http://localhost:8000  
- 기본 비밀번호: `1234` (개발용)

## Linux / macOS

```bash
cp deploy/desktop-local/.env.example deploy/desktop-local/.env
docker compose up -d memo-postgres   # 레포 루트 compose

cd api && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export $(grep -v '^#' deploy/desktop-local/.env | xargs)
.venv/bin/uvicorn app.main:app --reload --port 8000

cd web && npm install && npm run dev
```

## PC 허브로 쓸 때

- 같은 LAN의 폰: `http://<PC-LAN-IP>:3000` (방화벽 3000/8000 허용)
- PC를 끄면 다른 기기 동기화 중단 — **24h 싱크**는 [`hub`](../hub/) 또는 VPS 프로필 사용

## 데이터 위치

`DATA_DIR` (기본 `./data`) — `postgres/`, `uploads/`
