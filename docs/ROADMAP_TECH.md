# 로드맵 — 회귀·기술 부채

버그·리팩토링·에디터 구조. 인덱스: [`ROADMAP.md`](./ROADMAP.md)

---

## 회귀 / 재설계 필요

지금 코드에 들어가 있지만 동작이 어긋나서 원점에서 다시 손봐야 하는 항목들.

- [x] **위키링크 생성 흐름 전면 재설계** *(완료, `wikilinkExtension.ts`)*
  - 처리: React state 기반 메뉴 / Space 확정 keymap / `replaceWikilink` 우회
    제거. CodeMirror `@codemirror/autocomplete` 확장으로 옮겨, completion 의
    `apply` 가 한 transaction 으로 `[[Title]] ` (트레일링 스페이스 포함) 를 박고
    selection 을 그 뒤로 옮긴다 → cursor desync 가 구조적으로 사라짐.
  - 신규 노트 생성은 같은 `apply` 안에서 본문 dispatch 직후 별도 콜백으로 분리,
    본문 doc 은 단방향으로만 갱신.
  - 활성 줄 위젯 규칙도 단순화: "캐럿/선택이 링크 범위 안이면 raw, 아니면 위젯".
    트레일링 스페이스 신호는 더 이상 보지 않음.
- [x] **숫자만으로 된 노트 제목 저장 안 됨** *(2026-10-03 브라우저 확인: `987654` 저장됨)*
  - 증상: 새 노트 생성 후 제목 입력란에 `1234` 같이 숫자만 입력하면 그대로
    씹혀서 저장이 되지 않고 계속 "무제 노트" 로 남음.
  - 추정: 어딘가에서 제목 trim/parse 단계가 숫자만 들어온 입력을 빈 문자열로
    잘못 처리하거나, autosave 시 제목 변경이 백엔드에 반영되지 않는 듯.
  - 점검 포인트: `web/src/components/memo/Workbench.tsx` 의 제목 저장 흐름,
    `api.updateNote` 호출 직전의 normalize, 백엔드 `notes.title` validator.
- [x] **인라인 이미지 미리보기 해상도** *(수정)*
  - 원인: 본문 이미지가 480px 썸네일(`/thumbnail`)을 불러오는데, 이미지 블록은
    최대 1200px 까지 늘릴 수 있어 확대 시 흐려졌다.
  - 처리: `editorHydrate.ts` 가 본문 이미지도 원본(`/download`)을 불러오도록 변경.
    우측 첨부 패널의 작은 미리보기는 그대로 썸네일 사용.

### 직접 확인 필요 (2026-10 자동 저장·노트 전환 수정 이후)

에디터를 노트마다 새로 만들고(`key={note.id}`) 저장 응답으로 본문을 덮어쓰지
않게 바꿨다. 아래는 브라우저에서 손으로 확인하지 못한 항목.

- [ ] 한글 IME 입력 — 빠르게 치다 멈췄다 다시 칠 때 마지막 글자가 빠지지 않는지.
- [ ] 이미지 붙여넣기(`Ctrl+V`)·드래그 삽입 — 캐럿 위치에 마커가 들어가는지.
- [ ] 버전 복원 — 복원 후 본문이 화면에 바로 반영되는지.

---

## 기술 부채 / 리팩토링

### 코드 점검 결과 (2026-10) — 남은 항목

데이터 손실 (2026-10-03 수정, 브라우저 확인)
- [x] 노트 전환 후 `Ctrl+Z` 가 이전 노트 본문을 불러와 덮어씀 — CodeMirror 에
  `key={note.id}` 를 줘 노트마다 히스토리를 끊음.
- [x] 저장 응답이 요청~응답 사이 입력을 되돌림 — 응답으로 제목·본문을 덮어쓰지 않음.
- [x] 자동 저장이 방금 바꾼 태그·폴더를 되돌림 — 자동 저장은 제목·본문만 전송.
- [x] 그린 직후 노트 전환 시 그림 유실 — 전환 전에 `flushOverlayForNote`.
- [x] 태그 달린 노트 삭제가 500 (`StaleDataError`), 첨부 파일만 먼저 지워짐.

성능
- [~] **자동 저장 1회당 요청 4개** — 용량 조회는 제거(3개). 남은 것: 목록은 해당
  노트만 로컬 갱신, 버전은 패널 열림 시만.
- [ ] **키 입력마다 Workbench 전체 리렌더** — `setContent` 가 매 글자마다 사이드바
  (폴더별 filter+sort)까지 다시 그린다. 본문을 React state 에서 빼고(ref + 비제어
  에디터) 사이드바를 메모이즈. 버전 복원·할 일 토글·IME 경로를 같이 옮겨야 해서 위험.
- [ ] **줄 위젯이 입력마다 전부 재생성** — `RenderedMarkdownLineWidget.eq` 가
  `lineFrom` 을 비교해, 한 글자만 쳐도 캐럿 아래 모든 줄 DOM 이 새로 만들어진다
  (이미지 깜빡임, 재생 중 오디오 끊김). 위치를 클릭 시점에 `posAtDOM` 으로 구하게
  바꾸면 DOM 재사용 가능. 클릭·드래그·리사이즈 핸들러 전부 손봐야 함.
- [ ] **할 일 패널 N+1** — `refreshTodoItems` 가 노트마다 `getNote`. 백엔드에 할 일
  모음 API 추가(§0-1 「해당 줄로 이동」과 같이).
- [x] **노트 목록 API 불필요 로드** — 목록·검색 쿼리에서 첨부 로드를 빼고 본문·
  `overlay_strokes` 를 `defer`.
- [x] 업로드 핸들러가 이벤트 루프를 막음 — `async def` → `def`(스레드풀).
- [ ] 여러 노트 이동·삭제를 일괄 API로(현재 노트마다 요청).

안정성 / 정리
- [ ] **새 노트 제목 포커스 가드 단순화** — `armTitleFocusGuard` 타이머 13개는 이중
  마운트(해결됨) 대응용. 브라우저 확인하며 단일 포커스로 축소.
- [~] 확인창 통일 — 첨부 삭제는 `askConfirm` 으로 변경. 버전 복원만 `window.confirm`.
- [ ] 캐럿 위치 결정 로직 중복 — `insertMarkerAtCursor` / `insertTextAtCursor`.
- [ ] 그림 레이어 저장 타이머가 본문 저장마다 리셋 — effect 의존성의 `activeNote`.
- [ ] 이미지 blob URL 미해제(`editorHydrate.ts` `__blobCache`) — 세션 중 메모리 누적.
- [ ] 큰 원본 이미지 로딩 — 필요 시 업로드 때 1200px 중간 크기 생성.
- [ ] 버전 스냅샷 무한 누적 — 편집 중 120초마다 본문 전체가 쌓이고 정리 없음.
  노트당 최근 N개 또는 기간별 보존 규칙.
- [ ] 썸네일이 EXIF 회전 미반영 — `ImageOps.exif_transpose`.
- [ ] `PATCH /ai-jobs` 가 임의 status 문자열을 받음 — 응답 스키마는 5개 값만 허용해
  잘못된 값이 들어가면 목록 조회가 500.
- [ ] uvicorn `--reload` 가 변경을 감지하고도 옛 코드를 실행한 사례(Windows) —
  원인 미조사. 백엔드 수정이 반영 안 되면 API 재시작.
- [x] 휴지통 잔재 제거 — 삭제는 영구 삭제. 복원 화면·`restoreNote`·
  `POST /notes/{id}/restore` 제거, 첨부 삭제도 행+파일 영구 삭제.

배포 (로컬 dev 에서는 드러나지 않음, 미확인)
- [ ] `caddy/Caddyfile` 의 `Permissions-Policy: microphone=()` 가 음성 녹음을 차단.
  CSP 에 `media-src` 가 없어 blob 오디오 재생도 `default-src 'self'` 에 걸릴 수 있음.
- [ ] 프로덕션 안전 검사 구멍 — `.env.example` 의 예시 `JWT_SECRET` 이 35자라
  `assert_production_safe` 를 통과. 예시 값을 금지 목록에 추가.
- [ ] 전체 export zip 에 첨부 파일이 없음(`attachment://` 마커만).

기능 누락
- [x] **태그 생성 UI** — 노트의 「+ 태그」 드롭다운에 이름 입력칸(Enter 로 생성·부착,
  같은 이름은 재사용).
- [ ] 태그 삭제·이름 변경 UI 없음.

구조
- [ ] `Workbench.tsx`(약 1980줄) 커스텀 훅 분리 — `useAutosave`, `useAudioRecorder`,
  슬래시 메뉴, 폴더·노트 조작. 위 항목 처리 후.

- [~] **`Workbench.tsx` 4000줄 → 다시 모듈 분리** *(1·2·3·4차 분리 완료)*
  - 이전 라운드에서 한 번 쪼갰지만, 위키링크/슬래시 메뉴/그림 레이어/오디오/
    이미지 블록/멀티선택/명령 팔레트 등이 추가되면서 다시 4000줄을 넘김.
  - 1차 결과 (`3879090`)
    - 타입/순수 헬퍼 분리: `workbenchTypes.ts` (Panel/ListMode/SlashMenuState/
      ContextMenuTarget/HoverMeta/ConfirmDialogState/AppCommand 등),
      `workbenchHelpers.ts` (overlaySignature/todayNoteTitle/extractTodoItems).
    - 독립 오버레이 UI 분리: `CommandPalette.tsx`, `WorkbenchOverlays.tsx`
      (ContextMenu/HoverTooltip/ConfirmDialog).
    - 위키링크 React state + JSX 메뉴 + 키보드 effect 제거 → `wikilinkExtension.ts`.
    - 결과: `Workbench.tsx` ≈3856줄 → ≈3620줄.
  - 2차 결과 (`8a2da67`)
    - 사이드바 트리 + 검색 + DnD + 멀티선택 + 푸터 → `WorkbenchSidebar.tsx` (845줄).
    - `DragItem`/`CreatingFolderState`/`RenamingState`/`SelectionAnchor` 를
      `workbenchTypes.ts` 로 같이 승격.
    - 결과: `Workbench.tsx` ≈3620줄 → ≈3028줄.
  - 3차 결과
    - 모바일 정리/목록 카드 → `WorkbenchMobilePanels.tsx`
      (`MobileNavCard` + `MobileListCard`). *(이후 미사용으로 삭제 — 모바일은 네이티브 앱 담당)*
    - 명령 팔레트 / 슬래시 커맨드 정의 → `workbenchCommands.ts`
      (`buildAppCommands` + `buildSlashCommands`, deps 객체로 주입).
      관련 타입 (`SlashCommand`) 도 `workbenchTypes.ts` 로 같이 이동.
    - 우측 토글 패널 (첨부 / 할 일 / 버전) → `WorkbenchRightPanel.tsx`
      (3개의 내부 sub 컴포넌트 `FilesPanel` / `TodosPanel` / `VersionsPanel`).
    - `Workbench.tsx` 에서 더 이상 안 쓰이는 import 제거
      (`AppCommand`, `IconX`, `AuthenticatedImagePreview`).
    - 결과: `Workbench.tsx` ≈3028줄 → ≈2551줄.
  - 4차 결과
    - 메모 편집 영역 전체 → `WorkbenchEditor.tsx` (`WorkbenchEditorCard`).
      빈 상태 / 휴지통 복원 화면 / 메타·미디어·그리기 툴바 / 제목·태그 /
      CodeMirror · 슬래시 메뉴 오버레이 · `OverlayDrawingLayer`.
    - CodeMirror `extensions` 배열은 `useMemo` 로 `codeMirrorExtensions` 로 묶어
      자식에 넘김 (동작 동일).
    - 결과: `Workbench.tsx` ≈2551줄 → ≈2136줄 (신규 `WorkbenchEditor.tsx` ≈600줄).
  - `editor.ts` 모듈 분할 (2026-05-11)
    - 진입점 `editor.ts` 는 재export 전용(공개 API 유지).
    - `editorGlobals.ts` — **문서 캐럿만** (`getLastDocCursor` / `syncCursorFromView` 등).
      토큰·삽입·위키 이동 전역 슬롯은 제거함.
    - `editorContext.ts` — `memoEditorContextFacet` / `memoEditorContextExtension` /
      `getMemoEditorContext` (CodeMirror Facet 으로 인스턴스별 주입).
    - `editorCursor.ts` — `editorCursorTracker`, `editorCursorBackupSync`.
    - `editorAttachmentLine.ts` — 첨부 줄 판별·통째 삭제.
    - `editorHydrate.ts` — blob URL, 첨부/위키 DOM 하이드레이션.
    - `editorWidgets.ts` — 위젯 클래스 + `applyInlineHighlight`.
    - `editorDecorations.ts` — `hybridMarkdownField`.
    - `editorMediaInput.ts` — paste/drop.
    - `editorMouseHandlers.ts` — 우측 여백 더블클릭 등.
    - `editorKeymaps.ts` — 화살표·삭제·Enter·undo·`[]` 스페이스.
    - `editorTheme.ts` — `cmEditorVisualTheme`.
  - Facet 의존성 주입 (2026-05-11, 전역 슬롯 제거)
    - `Workbench.tsx` 가 `memoEditorContextExtension({ token, apiUrl, insertFile, navigateLink })`
      를 확장 배열 선두에 넣고, `insertFile` / `navigateLink` 는 ref 로 최신 클로저 유지.
    - 선택 후속: `createMemoEditorExtensions(ctx)` 로 확장 묶기만 정리(동작 동일).
  - 다음 단계 (남은 추천 순서)
    1. 제품 우선순위는 [`ROADMAP_PRODUCT.md`](./ROADMAP_PRODUCT.md) 맨 위 "다음 구현 우선순위".
    2. 회귀/품질: 이 파일 상단 **직접 확인 필요** 절 (한글 IME·이미지 붙여넣기·버전 복원).
    3. 플랫폼: [`ROADMAP_PRODUCT.md`](./ROADMAP_PRODUCT.md) **웹(데스크톱) · 네이티브 앱**
       (모바일·태블릿은 앱, 웹은 브라우저 검증 표).
    4. 구조: `Workbench.tsx` 가 여전히 크면 추가 셸 분리 또는 props/컨텍스트 범위 축소 검토.
