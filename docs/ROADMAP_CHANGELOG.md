# 로드맵 변경 이력

본문 백로그는 역할별 파일로 나뉘어 있다. [`ROADMAP.md`](./ROADMAP.md) 인덱스 참고.

- 2026-05-07: 로드맵 파일 생성. Phase 1 (마커 기반 인라인 미디어 + 음성 녹음) 까지 구현됨.
- 2026-05-08: 위키링크 1차 구현이 cursor desync / 렌더 시점 문제로 회귀로 분류,
  회귀 섹션 신설. 숫자 제목 저장 안 됨 / 인라인 이미지 해상도 / `Workbench.tsx` 분리
  필요 항목을 회귀·기술 부채에 정리.
- 2026-05-10: `Workbench.tsx` 1차 분리 (`workbenchTypes`, `workbenchHelpers`,
  `CommandPalette`, `WorkbenchOverlays`) + 위키링크 자동완성 재설계
  (`wikilinkExtension`, CodeMirror autocomplete 기반) 완료. 위키링크 회귀 항목과
  우선순위에서 위키링크 재설계 항목을 닫고, 다음 단계는 backlinks 패널.
- 2026-05-10: `Workbench.tsx` 2차 분리 → `WorkbenchSidebar.tsx` (트리 + 검색 +
  DnD + 멀티선택). `Workbench.tsx` ≈3620 → ≈3028줄.
- 2026-05-10: `Workbench.tsx` 3차 분리 → `WorkbenchMobilePanels.tsx`,
  `workbenchCommands.ts`, `WorkbenchRightPanel.tsx`. `Workbench.tsx`
  ≈3028 → ≈2551줄.
- 2026-05-11: `Workbench.tsx` 4차 분리 → `WorkbenchEditor.tsx`.
  `Workbench.tsx` ≈2551 → ≈2136줄.
- 2026-05-11: `editor.ts` 단일 파일 → `editorGlobals` / `editorCursor` /
  `editorAttachmentLine` / `editorHydrate` / `editorWidgets` / `editorDecorations` /
  `editorMediaInput` / `editorMouseHandlers` / `editorKeymaps` / `editorTheme` +
  `editor.ts` 재export. 이어서 Facet 기반 컨텍스트 주입으로 전역 슬롯 제거.
- 2026-05-11: `ROADMAP_NEXT.md` 추가 — 짧은 컨텍스트로 다음 작업만 볼 때 사용.
- 2026-05-11: 로드맵 분할 — `ROADMAP_PRODUCT.md`, `ROADMAP_PHASES.md`,
  `ROADMAP_PLATFORM.md`, `ROADMAP_TECH.md`, `ROADMAP_CHANGELOG.md` 로 이전하고
  `ROADMAP.md` 는 인덱스 전용으로 정리.
- 항목을 추가/소진할 때마다 가능하면 같은 PR 안에서 관련 로드맵 파일도 같이 갱신.
- 2026-05-11: `deploy/` 배포 프로필 분리 — VPS, 집 허브(저전력), 데스크톱 로컬, 본인 클라우드 VM. 제품 원칙: 벤더 메모 SaaS·제3자 동기화 저장소 없음.
- 2026-05-11: `ROADMAP_PRODUCT.md` 에 **모바일 · 태블릿 · 브라우저 호환** 절 신설
  (구현 백로그 + 수동 검증 표). 미디어 툴바 UX 잔여는 해당 절로 흡수.
  `ROADMAP_TECH.md` 다음 단계, `ROADMAP_NEXT.md`, `ROADMAP.md` 인덱스 표에 링크 반영.
- 2026-05-21: `ROADMAP_PRODUCT.md` **홈 · 바탕화면 위젯** 절에 **참고 서비스 분석
  (TickTick · 스케두)** 하위 절 추가 — 벤치마크·차이·CloudMemo 합성·구현 순서 재확인.
- 2026-05-11: `ROADMAP_PRODUCT.md` 에 **단축키 (기본 + 사용자 지정)** 절 추가.
  고정 기본(`Ctrl+Z` 등)·command id·노트/페이지 이동·scope·저장. §0·명령 팔레트·도움말 연동.
- 2026-05-11: `ROADMAP_PRODUCT.md` 에 **홈 · 바탕화면 위젯 (Rainmeter 스타일)** 절 추가.
  오늘 노트·빠른 메모·캘린더, Windows/macOS/iOS·Android 백로그. `ROADMAP_PLATFORM.md`
  캘린더·`ROADMAP.md`·`ROADMAP_NEXT.md` 링크.
- 2026-05-11: `ROADMAP_PRODUCT.md` 에 **Obsidian 볼트 이식 (import)** 절 추가.
  §0 우선순위 8번, MVP/2차 범위·기술 메모. `ROADMAP_NEXT.md` 우선순위 문구 반영.
- 2026-05-11: 동 절을 **웹(데스크톱) · 네이티브 앱(모바일·태블릿)** 으로 재정의.
  폰·태블릿은 별도 앱, 웹은 데스크톱 브라우저 검증 중심. 인덱스·`ROADMAP_NEXT`·
  `ROADMAP_TECH` 문구 갱신.
