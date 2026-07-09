# VPS 배포

본인이 임대한 Linux VPS에 **Docker Compose**로 전체 스택을 띄웁니다.  
데이터는 **당신의 디스크**에만 있으며, Cloud Memo 운영자의 클라우드가 아닙니다.

## 요구 사항

- Docker + Docker Compose v2
- (권장) 본인 도메인 → VPS A 레코드

## 빠른 시작

```bash
git clone https://github.com/baechubaechu/Cloud-Memo.git /opt/cloud-memo
cd /opt/cloud-memo
cp deploy/vps/.env.example deploy/vps/.env
nano deploy/vps/.env   # JWT_SECRET, INITIAL_USER_PASSWORD, DOMAIN 등
bash deploy/vps/setup.sh
```

`JWT_SECRET` 생성:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 수동 실행

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d --build
```

## 접속

- `DOMAIN` 설정 시: `https://<DOMAIN>`
- 로컬 테스트: `http://localhost` (Caddy 80)

## 백업

- `DATA_DIR/postgres` + `DATA_DIR/uploads`
- `pg_dump` 정기 실행 권장
