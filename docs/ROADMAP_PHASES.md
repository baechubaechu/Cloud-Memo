# 로드맵 — 미디어 / 블록 문서 모델 (Phase 2 ~ 6)

장기 아키텍처·미디어 파이프라인. 인덱스: [`ROADMAP.md`](./ROADMAP.md)

Phase 1 (마커 기반 인라인 첨부) 까지는 `feat/phase1-multimedia-blocks` 브랜치에서
완료됨. 그 이후 단계.

- [ ] **Phase 2 — 인라인 마커 위치 다양화**
  - 지금은 한 줄 = 한 미디어. 줄 중간에도 인라인 이미지/오디오 들어가게.
- [ ] **Phase 2.5 — 자유 위치/크기 이미지 블록**
  - 현재: 이미지 한 줄을 block widget 으로 잡고 있어서 글자처럼 취급되고
    캐럿 높이도 이미지 만큼 커진다.
  - 목표: 이미지 자체를 atomic 블록으로 다루고
    - 우측 하단 핸들 드래그로 크기 조정
    - 좌/중/우 정렬 토글
    - 마커 형식을 `![filename|w=400](attachment://uuid)` 처럼 확장
    - 캐럿은 이미지 위/아래 텍스트 줄에만 머무르고, 이미지 자체에는 안 들어감.
- [x] **Phase 3 v1 — 본문 위 자유 그림 레이어 (그림판/필기)** *(구현됨)*
  - 본문 영역 위에 SVG 레이어를 띄워서 텍스트/이미지와 겹쳐 자유롭게 그릴 수
    있다. 텍스트 모드에서는 `pointer-events: none` 으로 입력이 통과해 에디터가
    정상 동작.
  - 도구: 펜 / 형광펜(반투명) / 지우개(stroke 단위), 색·굵기 슬라이더,
    undo / redo / 전부 지우기.
  - stroke JSON 으로 저장: `notes.overlay_strokes JSONB`, 자동 저장(700ms
    디바운스, 본문 자동 저장과 분리). 노트 단위로 history 초기화.
  - 좌표는 본문 컨텐츠 좌상단 기준 논리 픽셀, 본문과 함께 스크롤. 가로폭이
    바뀌면 stroke 의 `captureWidth` 대비 스케일링.
  - Pointer Events 기반이라 마우스/터치/펜 모두 받음. `pressure` 는 stroke
    초기 굵기 보정에 한 번만 반영(향후 per-point 로 확장).
- [ ] **Phase 3 v2 — 그림 레이어 정밀화**
  - per-point 압력/속도로 굵기 가변 (필기감)
  - 지우개 부분 지움(픽셀/segment 단위), eraser 미리보기 커서
  - stroke 를 "특정 문단/블록 anchor + 상대 좌표" 로 묶어서, 위 줄이 늘어나
    텍스트가 흘러도 그림이 그 위치에 따라 붙도록 (텍스트 reflow 대응)
  - 매우 많은 stroke 가 쌓일 때 SVG → 오프스크린 캔버스 폴백
  - 페이지 전체 export 시 SVG overlay 를 PNG/PDF 로 합성
  - Apple Pencil / S Pen 의 부속 버튼/지우개 끝(eraser pointerType) 인식
- [ ] **Phase 4 — STT 통합**
  - 녹음 직후 옵션으로 자동 텍스트 변환 → 같은 노트에 텍스트 블록 삽입
  - STT 엔진 선택 ([`ROADMAP_PLATFORM.md`](./ROADMAP_PLATFORM.md) 의 엔진 선택 UI 와 연결)
- [ ] **Phase 5 — TTS**
  - 본문 / 선택 구간 → 음성 생성 → 노트에 자동 첨부
  - 목소리 / 속도 / 언어 프리셋
- [ ] **Phase 6 — 완전 블록 문서 모델 (`document_blocks`)**
  - 텍스트 / 이미지 / 캔버스 / 오디오 / TTS 를 동일한 블록 단위로 관리
  - 협업 / 권한 / 실시간 편집 확장의 기반
