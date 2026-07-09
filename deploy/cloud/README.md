# 클라우드 VM 프로필 (본인 계정)

AWS Lightsail, Hetzner, Oracle Cloud Free Tier, GCP Compute 등 **본인이 임대·소유한 VM**에 올립니다.

## 이것이 아닌 것

| ❌ | ✅ |
|----|-----|
| Cloud Memo 회사가 돌리는 메모 SaaS | **당신 이름으로 임대한 VM 한 대** |
| Dropbox / iCloud / S3에 메모 상주 | VM 디스크의 `DATA_DIR`만 사용 |
| (미구현) 제3자 동기화 백엔드 | FastAPI + Postgres on **your** VM |

데이터는 **클라우드 회사의 “메모 서비스”**가 아니라 **당신이 켠 VM의 디스크**에 있습니다.  
(물리적으로는 IDC 랙에 있지만, 통제·암호화·백업은 사용자 책임.)

## 배포 방법

VPS 프로필과 **동일한 compose**를 사용합니다.

```bash
git clone https://github.com/baechubaechu/Cloud-Memo.git /opt/cloud-memo
cd /opt/cloud-memo
cp deploy/cloud/.env.example deploy/cloud/.env
# DOMAIN, JWT_SECRET, 비밀번호 수정
bash deploy/vps/setup.sh
```

또는 `deploy/cloud/.env`를 쓰려면:

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/cloud/.env up -d --build
```

## 호스터별 팁

- **Lightsail / Hetzner**: Ubuntu + Docker 설치 후 `setup.sh`
- **방화벽**: 80, 443 (Caddy) 인바운드 허용
- **도메인**: VM 공인 IP → A 레코드 → `DOMAIN` 설정

## BYOS (S3 / WebDAV 등)

현재 **미구현**. 제3자 저장소에 암호문을 올리는 방식은 제품 정체성(정보 보호)과 맞지 않아 로드맵에서 별도·비권장으로 둡니다.
