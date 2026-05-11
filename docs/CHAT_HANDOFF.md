# 채팅 이어하기 / 세션 핸드오프

이 파일은 **레포 경로를 옮긴 뒤에도** 새 채팅방에서 맥락을 복구하기 위해 남긴 요약이다.
새 대화를 열면 `@docs/CHAT_HANDOFF.md` 또는 이 파일 내용을 붙여 넣어도 된다.

## 레포 위치 (현재)

- **경로:** `C:\Users\user\CloudMemo` (이전: `.cursor\projects\empty-window\cloud-memo` 에서 이동)
- **브랜치:** `feat/phase1-multimedia-blocks`
- **마지막 커밋:** `bae1ad8` — `refactor(memo): split monolithic editor.ts into focused modules`

## 이 채팅에서 다룬 큰 줄기

- Cloud Memo: Obsidian 스타일 마크다운 에디터, 사이드바/DnD/멀티선택, 위키링크 재설계(CodeMirror autocomplete), 명령 팔레트·슬래시 등.
- **`Workbench.tsx` 모듈 분리 (진행 순서 합의):**
  1. 모바일 `navCard` / `listCard` → `WorkbenchMobilePanels.tsx` ✓
  2. `appCommands` / `slashCommands` → `workbenchCommands.ts` ✓
  3. 우측 패널 → `WorkbenchRightPanel.tsx` ✓
  4. 에디터 쉘 → `WorkbenchEditor.tsx` (`WorkbenchEditorCard`) ✓ (2026-05-11)
  5. `editor.ts` 기능별 분할(10개 모듈 + `editor.ts` 재export) ✓ (2026-05-11)
  6. **다음:** 전역 슬롯 → `createMemoEditorExtensions({ ... })` factory 의존성 주입 (§12)
- **장기:** `editor.ts` 전역 슬롯(`__authCtx` 등) 제거, `createMemoEditorExtensions({ ... })` 형태 **factory 의존성 주입** — Workbench 분리 이후 2차 정리로 로드맵에 적어둠.

## 주요 파일 위치 (프런트)

- `web/src/components/memo/Workbench.tsx` — 줄 수 감소 중 (`WorkbenchEditor.tsx` 분리됨).
- `web/src/components/memo/WorkbenchSidebar.tsx`, `WorkbenchMobilePanels.tsx`, `WorkbenchRightPanel.tsx`
- `web/src/components/memo/workbenchCommands.ts`, `workbenchTypes.ts`, `workbenchHelpers.ts`
- `web/src/components/memo/wikilinkExtension.ts`, `editor.ts`

## 운영 메모

- 프런트/백 로컬 + DB만 Docker 같은 구성을 썼음; Docker Desktop 꺼져 있으면 `docker` 명령 실패할 수 있음.
- **같은 채팅 탭 유지:** 워크스페이스만 `C:\Users\user\CloudMemo`로 열면 대화는 남을 수 있으나, 제품 동작은 버전마다 다를 수 있음. 확실히 하려면 이 파일 + 필요 시 `@파일` 참조.

## 이 파일을 업데이트할 때

- 큰 작업(커밋, 브랜치 전환, 레포 경로 재이동) 후 **한 줄이라도** 날짜·커밋·다음 할 일을 고칠 것.

---

*작성: 레포를 `C:\Users\user\CloudMemo`로 이동한 직후, 채팅 이어쓰기용.*
