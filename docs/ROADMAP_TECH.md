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
- [ ] **숫자만으로 된 노트 제목 저장 안 됨**
  - 증상: 새 노트 생성 후 제목 입력란에 `1234` 같이 숫자만 입력하면 그대로
    씹혀서 저장이 되지 않고 계속 "무제 노트" 로 남음.
  - 추정: 어딘가에서 제목 trim/parse 단계가 숫자만 들어온 입력을 빈 문자열로
    잘못 처리하거나, autosave 시 제목 변경이 백엔드에 반영되지 않는 듯.
  - 점검 포인트: `web/src/components/memo/Workbench.tsx` 의 제목 저장 흐름,
    `api.updateNote` 호출 직전의 normalize, 백엔드 `notes.title` validator.
- [ ] **인라인 이미지 미리보기 해상도**
  - 증상: 본문에 첨부된 이미지의 미리보기가 흐릿하게 보임.
  - 점검 포인트
    - 백엔드 attachments 라우트가 원본을 그대로 내려주는지, 어딘가에서 썸네일
      변환이 끼어드는지.
    - 프런트의 `<img>` 가 `width/height` 강제로 다운스케일하고 있지 않은지
      (`object-fit: cover` + 작은 컨테이너 등).
    - 첨부 업로드 단계에서 자동 압축 / 리사이즈가 들어가는지.
    - CDN/Caddy 캐싱과 Content-Type 도 같이 확인.

---

## 기술 부채 / 리팩토링

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
      (`MobileNavCard` + `MobileListCard`).
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
    2. 회귀/품질: 이 파일 상단 **회귀** 절 (숫자만 제목 저장, 인라인 이미지 해상도).
    3. 플랫폼: [`ROADMAP_PRODUCT.md`](./ROADMAP_PRODUCT.md) **웹(데스크톱) · 네이티브 앱**
       (모바일·태블릿은 앱, 웹은 브라우저 검증 표).
    4. 구조: `Workbench.tsx` 가 여전히 크면 추가 셸 분리 또는 props/컨텍스트 범위 축소 검토.
