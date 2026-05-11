# 구현 예정 (Roadmap)

> 사용자가 대화에서 언급했지만 아직 구현되지 않은 기능들을 정리해 둔 단일 진실
> 소스 (single source of truth) 입니다. 새 기능이 합의되면 여기에 항목을 추가하고,
> 구현이 끝나면 해당 줄을 PR/커밋 해시와 함께 삭제하거나 "완료"로 옮깁니다.
>
> 우선순위는 위쪽이 더 빨리 손댈 가능성이 큰 항목입니다. 정확한 일정은 따로
> 정하지 않고, 사용자가 다음 작업을 지시하면 그 자리에서 우선순위가 갱신됩니다.

---

## 0. 다음 구현 우선순위

지금 앱의 완성도를 가장 빠르게 올릴 순서. 대형 구조 변경보다, 현재 에디터와
사이드바/검색 흐름 위에 바로 얹을 수 있는 기능을 우선한다.

1. **체크리스트 클릭 토글 + 모든 할 일 모아보기**
   - `- [ ]`, `- [x]` 를 실제 체크박스처럼 클릭해서 토글.
   - 전체 노트의 미완료 항목을 한 화면에 모아 보고, 클릭하면 해당 노트로 이동.
2. **명령 팔레트 + 슬래시 커맨드**
   - 명령 팔레트: `Ctrl+K` / `Ctrl+P` 로 앱 명령 실행.
   - 슬래시 커맨드: 본문에서 `/` 로 체크리스트, 이미지, 그림, 제목 등을 삽입.
3. **위키링크 백링크 패널**
   - 본문 위키링크 자동완성은 `wikilinkExtension.ts` (CodeMirror autocomplete 기반)
     으로 재설계 완료. 다음 단계는 노트별 backlinks 패널 / "이 노트를 참조하는 노트"
     집계 / 깨진 링크 표시.
4. **데일리 노트**
   - 오늘 날짜 노트를 빠르게 열고, 날짜 링크/캘린더 기능의 기반으로 사용.
5. **노트 리스트 정렬 옵션**
   - 수정일 / 생성일 / 제목 순, 오름차순/내림차순, 폴더별 기본값.
6. **단어·글자 수 / 읽기 시간 + 단축키 도움말**
   - 구현 범위가 작고 매일 보이는 체감 품질 개선.
7. **단일 노트 export**
   - Markdown / PDF. PDF 는 그림 오버레이와 이미지 합성까지 고려.
8. **다크 모드**
   - 시스템 설정 연동 + 수동 토글.
9. **Phase 3 v2 / STT / TTS / AI / 협업**
   - 위 기본 생산성 기능을 다듬은 뒤 큰 기능으로 이동.

---

## 1. AI 편집 / 통합 (옵시디언처럼 AI 가 노트에 직접 접근)

핵심 가정: 옵시디언은 노트가 파일이라 AI 가 vault 디렉터리 권한으로 read/write 한다.
이 프로젝트는 노트가 PostgreSQL + 첨부 파일시스템에 있으므로 동등한 그림은
"DB / 첨부 / API 중 하나에 권한을 가진 AI" 형태가 된다.

- [ ] **A. 백엔드 워커 기반 AI 작업** (`worker/` + `ai_jobs` 테이블 이미 보유)
  - STT, 요약, 자동 태그, 백링크 추천 등 비동기 작업
  - DB 직접 접근 (가장 강한 권한)
- [ ] **B. MCP 서버로 노트 도구 노출**
  - "노트 검색 / 생성 / 수정 / 링크 / 첨부 다루기" 를 MCP tool 로 제공
  - Cursor / Claude Desktop 같은 외부 AI 가 곧바로 활용 (옵시디언 + AI 와 가장 유사)
- [ ] **C. AI 전용 API 토큰 + 외부 에이전트**
  - 단일 비밀번호와 별개로 발급. 권한(read-only / scope 제한) 정책화
- [ ] **D. 클라이언트 사이드 모델 (보조)**
  - 빠른 자동완성, 임베딩 등 짧은 작업용
- [ ] **E. 엔진 선택 UI**
  - 작업별로 Cloud API (OpenAI/Anthropic 등) vs Local Model (Whisper, Piper 등) 선택
  - 실패 / 비용 / 지연 표시
- [ ] **F. 감사 로그**
  - 어떤 AI 가 어떤 노트를 언제 어떻게 바꿨는지 추적 (회사용 단계에서 필수)

---

## 2. 미디어 / 블록 문서 모델 (Phase 2 ~ 6)

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
  - STT 엔진 선택 (위 1-E 와 연결)
- [ ] **Phase 5 — TTS**
  - 본문 / 선택 구간 → 음성 생성 → 노트에 자동 첨부
  - 목소리 / 속도 / 언어 프리셋
- [ ] **Phase 6 — 완전 블록 문서 모델 (`document_blocks`)**
  - 텍스트 / 이미지 / 캔버스 / 오디오 / TTS 를 동일한 블록 단위로 관리
  - 협업 / 권한 / 실시간 편집 확장의 기반

---

## 3. 지식 연결 / 데일리 노트

- [ ] **위키링크 `[[노트 제목]]`** *(재설계 필요 — §11)*
  - 본문에서 `[[` 입력 시 기존 노트 자동완성.
  - 선택하면 `[[노트 제목]]` 삽입.
  - 없는 제목이면 새 노트 생성 옵션 제공.
  - 렌더링된 링크 클릭 시 해당 노트로 이동.
  - 1차 구현은 메뉴 + Space 확정 방식으로 시도했으나 cursor desync / 렌더
    시점 문제로 쓰기 어렵다고 판단. §11 참고하여 다른 축으로 다시 설계.
- [ ] **백링크 패널**
  - 현재 노트를 `[[현재 노트 제목]]` 으로 참조하는 다른 노트 목록.
  - 우측 패널에 "백링크" 탭 추가.
  - 향후 AI 백링크 추천 / 그래프 뷰와 연결.
- [ ] **데일리 노트**
  - 오늘 날짜(`YYYY-MM-DD`) 노트를 한 번에 열기/생성.
  - 날짜 링크 `[[2026-05-08]]` 를 데일리 노트로 취급.
  - 향후 캘린더 뷰와 연결.

---

## 4. 체크리스트 / 할 일

- [ ] **체크리스트 클릭 토글**
  - 렌더링된 `- [ ]`, `- [x]` 를 실제 체크박스처럼 클릭.
  - 클릭 시 본문 원문을 `- [ ]` ↔ `- [x]` 로 갱신.
  - Ctrl+Z / Ctrl+Y 로 되돌리기 가능해야 함.
- [ ] **모든 할 일 모아보기**
  - 전체 노트에서 미완료 체크리스트를 수집.
  - 사이드바/우측 패널/전용 뷰 중 하나로 표시.
  - 항목 클릭 시 해당 노트와 줄 위치로 이동.
  - 완료 토글 시 원본 노트 본문도 즉시 반영.

---

## 5. 편집 생산성

- [ ] **명령 팔레트**
  - `Ctrl+K` 또는 `Ctrl+P` 로 여는 앱 전체 명령 검색창.
  - 새 노트, 오늘 노트 열기, 그리기 모드, 이미지 삽입, export, 단축키 도움말
    같은 명령을 키보드로 실행.
- [ ] **슬래시 커맨드**
  - 본문에서 `/` 를 입력하면 삽입 메뉴 표시.
  - 예: `/체크리스트`, `/제목`, `/이미지`, `/그림`, `/음성`, `/날짜`.
  - Notion 스타일 UX. 명령이 많아졌을 때 유용.
- [ ] **콜아웃 / 인용 블럭 (보류)**
  - 예: `> [!warning]` 같은 문법을 경고/정보 박스로 렌더.
  - 체크박스와 직접 충돌하지는 않음. 체크박스는 `- [ ]`, 콜아웃은 `>` 로
    시작해 문법 prefix 가 다르다.
  - 다만 지금 우선순위는 낮으므로 보류.
- [ ] **코드블럭 신택스 하이라이트 (보류/낮음)**
  - 개발 노트를 많이 쓸 때 코드 색상 표시.
  - 현재 앱 방향에서는 필수성이 낮아 우선순위에서 제외.

---

## 6. 내보내기 / 앱 UX

- [ ] **단어·글자 수 / 읽기 시간**
  - 본문 하단 또는 메타 툴바에 작게 표시.
  - 공백 제외 글자 수, 단어 수, 예상 읽기 시간.
- [ ] **단일 노트 export**
  - 현재 노트만 Markdown 파일로 저장.
  - PDF export 는 이미지 / 그림 오버레이 합성까지 포함.
  - 향후 공유 링크 / 백업 기능과 연결.
- [ ] **다크 모드**
  - 시스템 설정 자동 감지.
  - 수동 토글.
  - 에디터 / 사이드바 / 이미지 툴바 / 그림 레이어 툴바 모두 대응.
- [ ] **단축키 도움말**
  - `?` 또는 메뉴 버튼으로 단축키 모달 표시.
  - 예: 새 노트, 검색, 저장, undo/redo, 그리기 모드, 이미지 삽입.
- [ ] **노트 리스트 정렬 옵션**
  - 수정일 / 생성일 / 제목.
  - 오름차순 / 내림차순.
  - 폴더별 정렬 유지 또는 전역 설정.

---

## 7. 협업 / 공유

웹 서비스의 대표 강점.

- [ ] 노트 / 폴더 단위 공유 링크
  - 만료일, 비밀번호, 읽기 전용 / 댓글 / 편집 권한
- [ ] 실시간 공동 편집
  - 1단계: 단순 저장 순서 / 섹션 잠금
  - 2단계: 진짜 실시간 커서 (CRDT / OT — Phase 6 블록 모델과 시너지)
- [ ] 게스트 / 외부 사용자 초대
- [ ] 변경 알림 / 멘션

---

## 8. 일정 / 캘린더

당장은 필수 아님 — 노트와의 연동을 가볍게 시작.

- [ ] 노트 프론트매터 `due:` 또는 `[[YYYY-MM-DD]]` 인식 → 읽기용 캘린더 뷰
- [ ] 일정에서 노트로 역링크
- [ ] (선택) 알림 / 반복 일정 — 신중히

---

## 9. 인증 / 권한 강화 (서비스화 시점에 본격)

지금은 단일 비밀번호 잠금 모드로 충분. 회사 / 다인 사용 검토 시작하면.

- [ ] 사용자 계정 + 강한 비밀번호 정책 + 세션 만료 + 로그인 시도 제한
- [ ] 2FA (TOTP)
- [ ] Owner / Editor / Viewer 권한 모델
- [ ] HTTPS 강제 / secure cookie / CSRF / JWT rotation
- [ ] 자동 백업 + 복구 리허설 문서

---

## 10. UX 잔여 작업

작은 항목들. 시간 날 때 정리.

- [ ] 멀티선택 상태에서 `Esc` 로 선택 해제
- [ ] 첨부 패널 "파일 업로드" 도 본문에 마커 자동 삽입할지 옵션 제공
- [ ] 우상단 미디어 버튼 hover 시 단축키 힌트 (`Ctrl+V`, drag/drop 안내)
- [ ] 모바일 반응형에서 미디어 삽입 툴바 위치 / 손 크기 고려
- [ ] 첨부 다 지웠을 때 본문 마커도 같이 정리 / 깨진 마커 placeholder 표시

---

## 11. 회귀 / 재설계 필요

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

## 12. 기술 부채 / 리팩토링

- [~] **`Workbench.tsx` 4000줄 → 다시 모듈 분리** *(1·2·3·4차 분리 완료, `editor.ts` 쪽 남음)*
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
  - 3차 결과 (이번 라운드)
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
    - `editorGlobals.ts` — 전역 슬롯·문서 캐럿 (`setEditor*` / `getLastDocCursor` 등).
    - `editorCursor.ts` — `editorCursorTracker`, `editorCursorBackupSync`.
    - `editorAttachmentLine.ts` — 첨부 줄 판별·통째 삭제.
    - `editorHydrate.ts` — blob URL, 첨부/위키 DOM 하이드레이션.
    - `editorWidgets.ts` — 위젯 클래스 + `applyInlineHighlight`.
    - `editorDecorations.ts` — `hybridMarkdownField`.
    - `editorMediaInput.ts` — paste/drop.
    - `editorMouseHandlers.ts` — 우측 여백 더블클릭 등.
    - `editorKeymaps.ts` — 화살표·삭제·Enter·undo·`[]` 스페이스.
    - `editorTheme.ts` — `cmEditorVisualTheme`.
  - 다음 단계 (남은 추천 순서)
    1. 마지막에 `createMemoEditorExtensions(...)` factory 로 묶어서
       `editor.ts` 의 모듈 전역 슬롯 (`__authCtx`, `__insertFile`, `__navigateLink`)
       을 인스턴스별 의존성 주입으로 교체.
       - 동기: 지금은 에디터가 사실상 한 개라 잘 동작하지만, 미리보기 / 분할
         편집 / 임베드 에디터 같은 게 생기면 곧장 충돌. HMR 중 슬롯이 stale
         하게 남거나 새 슬롯과 섞이는 케이스도 있음.
       - 새 API 후보:
         ```ts
         createMemoEditorExtensions({ authCtx, insertFile, navigateLink })
         ```
         → 호출자가 인스턴스마다 의존성을 명시적으로 넘긴다.
       - 이 단계는 전역 슬롯을 유지한 채로도 동작은 동일; factory 는 테스트·멀티
         에디터 대비용으로 후순위.
  - 분리하면서 props drilling 보다 `EditorContext` 같은 가벼운 컨텍스트로
    상태 공유 범위를 줄이는 것을 같이 검토.

---

## 변경 이력 / 운영 메모

- 2026-05-07: 파일 생성. Phase 1 (마커 기반 인라인 미디어 + 음성 녹음) 까지 구현됨.
- 2026-05-08: 위키링크 1차 구현이 cursor desync / 렌더 시점 문제로 회귀로 분류,
  §11 신설. 숫자 제목 저장 안 됨 / 인라인 이미지 해상도 / `Workbench.tsx` 분리
  필요 항목을 §11~§12 에 정리.
- 2026-05-10: `Workbench.tsx` 1차 분리 (`workbenchTypes`, `workbenchHelpers`,
  `CommandPalette`, `WorkbenchOverlays`) + 위키링크 자동완성 재설계
  (`wikilinkExtension`, CodeMirror autocomplete 기반) 완료. §11 위키링크 항목과
  §0 우선순위에서 위키링크 재설계 항목을 닫고, 다음 단계는 backlinks 패널.
- 2026-05-10: `Workbench.tsx` 2차 분리 → `WorkbenchSidebar.tsx` (트리 + 검색 +
  DnD + 멀티선택). `Workbench.tsx` ≈3620 → ≈3028줄. 다음 추천 순서를 §12 에
  기록 (UI 추가 분리 → `editor.ts` 기능별 분리 → factory 의존성 주입).
- 2026-05-10: `Workbench.tsx` 3차 분리 → `WorkbenchMobilePanels.tsx`
  (모바일 정리/목록 카드), `workbenchCommands.ts` (명령 팔레트·슬래시 커맨드
  정의), `WorkbenchRightPanel.tsx` (첨부/할 일/버전). `Workbench.tsx`
  ≈3028 → ≈2551줄. 다음 단계는 에디터 쉘 (`WorkbenchEditor.tsx`).
- 2026-05-11: `Workbench.tsx` 4차 분리 → `WorkbenchEditor.tsx` (편집 셸 전체).
  `Workbench.tsx` ≈2551 → ≈2136줄. 다음은 §12 의 `editor.ts` 파일 분할 +
  factory 의존성 주입.
- 2026-05-11: `editor.ts` 단일 파일(~1410줄) → `editorGlobals` / `editorCursor` /
  `editorAttachmentLine` / `editorHydrate` / `editorWidgets` / `editorDecorations` /
  `editorMediaInput` / `editorMouseHandlers` / `editorKeymaps` / `editorTheme` +
  `editor.ts` 재export 진입점. 다음은 factory 의존성 주입(전역 슬롯 제거).
- 항목을 추가/소진할 때마다 가능하면 같은 PR 안에서 이 파일도 같이 갱신.
