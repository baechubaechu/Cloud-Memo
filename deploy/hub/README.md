# 집 허브 (저전력 기기) 프로필

**항상 켜진 사용자 소유 허브** — 라즈베리 파이, NAS, 미니 PC 등.  
Caddy·AI 워커를 빼서 리소스를 줄였습니다. 밖에서 접속할 때는 **Tailscale** 등 개인 VPN을 권장합니다.

> 제3자 메모 클라우드(SaaS)가 아닙니다. 데이터는 이 기기의 `DATA_DIR`에만 있습니다.

## 권장 사양 (참고)

| 항목 | 권장 |
|------|------|
| 보드 | Raspberry Pi 5 **4GB+** + NVMe SSD |
| 저장 | 256GB~ (첨부 많으면 512GB+) |
| 전력 | 유휴 약 3W 전후 (24h 연간 전기 ~1–2만 원대) |

## 빠른 시작

```bash
cd /opt/cloud-memo   # 또는 clone 경로
cp deploy/hub/.env.example deploy/hub/.env
nano deploy/hub/.env
bash deploy/hub/setup.sh
```

## 밖에서 접속 (Tailscale 예시)

1. 허브에 [Tailscale](https://tailscale.com/) 설치·로그인  
2. 폰·노트북에도 같은 tailnet 가입  
3. `NEXT_PUBLIC_API_URL` / `CORS_ORIGINS`를 Tailscale IP 또는 MagicDNS로 맞춘 뒤 **재빌드**  
4. 폰 브라우저에서 `http://<허브-tailscale>:3000`

포트포워딩 없이 **본인 네트워크**로만 접속됩니다.

## NAS

시놀로지·QNAP 등 Docker 지원 NAS는 동일 compose를 GUI에서 import 하거나 SSH로 `setup.sh` 실행.

## 향후

v1 제품화 시 허브 전용 이미지( API+DB만, 클라이언트는 각 기기 앱 )로 더 가벼워질 수 있습니다.
