# Cloud Memo 배포 프로필

Cloud Memo는 **벤더 메모 SaaS가 아닙니다.** 데이터는 사용자가 통제하는 인프라(본인 VPS, 집 허브, PC)에만 둡니다.  
동기화·항상 켜진 허브는 **제3자 동기화 클라우드(Dropbox, iCloud 등)가 아닌, 사용자 소유 접점**을 전제로 합니다.

| 프로필 | 대상 | 문서 |
|--------|------|------|
| **VPS** | 본인 임대 서버, 도메인 + HTTPS | [`vps/README.md`](./vps/README.md) |
| **허브 (저전력)** | 라즈베리 파이, NAS, 24h 가동 집 장치 | [`hub/README.md`](./hub/README.md) |
| **데스크톱 로컬** | 개발·PC 허브, Docker 최소 | [`desktop-local/README.md`](./desktop-local/README.md) |
| **클라우드 VM** | AWS Lightsail, Hetzner 등 **본인 계정** VM | [`cloud/README.md`](./cloud/README.md) |

## 어떤 프로필을 쓸까

```
밖에서도 항상 싱크 + 내 데이터만
  → hub (집) 또는 vps / cloud (본인 서버)

개발·기능 수정
  → desktop-local

파워유저 Docker 풀스택 (루트 compose)
  → 레포 루트 docker-compose.yml (VPS와 동일 구성)
```

## 공통

- 인증: 단일 비밀번호 잠금 (JWT)
- 데이터: `DATA_DIR` 아래 Postgres + `uploads/`
- 백업: `pg_dump` + `uploads/` 스냅샷

상세 제품·로드맵: [`docs/ROADMAP_PRODUCT.md`](../docs/ROADMAP_PRODUCT.md)
