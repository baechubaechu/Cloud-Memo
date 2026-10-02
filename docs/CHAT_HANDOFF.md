# 채팅 이어하기 / 세션 핸드오프

이 파일은 **레포 경로를 옮긴 뒤에도** 새 채팅방에서 맥락을 복구하기 위해 남긴 요약이다.
새 대화를 열면 `@docs/CHAT_HANDOFF.md` 또는 이 파일 내용을 붙여 넣어도 된다.

## 레포 위치 (현재)

- **경로:** `C:\Users\user\CloudMemo` (이전: `.cursor\projects\empty-window\cloud-memo` 에서 이동)
- **브랜치:** `main`
- **마지막 작업:** 2026-10-03 — 자동 저장·노트 전환 데이터 손실 수정, 휴지통 없는 삭제,
  태그 생성 UI. 상세는 [`ROADMAP_CHANGELOG.md`](./ROADMAP_CHANGELOG.md) 마지막 두 줄.

## 다음 세션 시작점

새 작업 전에 [`ROADMAP_NEXT.md`](./ROADMAP_NEXT.md) 맨 위 **「다음에 켜자마자 — 브라우저로 직접
확인」** 목록부터 본다 (자동 저장·동기화·오프라인을 사람이 직접 확인).

## 이 채팅에서 다룬 큰 줄기

- Cloud Memo: Obsidian 스타일 마크다운 에디터, 사이드바/DnD/멀티선택, 위키링크 재설계(CodeMirror autocomplete), 명령 팔레트·슬래시 등.
- **`Workbench.tsx` 모듈 분리 (진행 순서 합의):**
  1. 모바일 `navCard` / `listCard` → `WorkbenchMobilePanels.tsx` ✓ (이후 미사용으로 삭제)
  2. `appCommands` / `slashCommands` → `workbenchCommands.ts` ✓
  3. 우측 패널 → `WorkbenchRightPanel.tsx` ✓
  4. 에디터 쉘 → `WorkbenchEditor.tsx` (`WorkbenchEditorCard`) ✓ (2026-05-11)
  5. `editor.ts` 기능별 분할(10개 모듈 + `editor.ts` 재export) ✓ (2026-05-11)
  6. 전역 슬롯 제거 → CodeMirror **Facet** (`editorContext.ts` + `memoEditorContextExtension`) 으로 주입 완료 (2026-05-11). 선택 후속: `createMemoEditorExtensions` 로 확장만 묶기.
- **로드맵:** 본문은 역할별로 분리됨. 짧게 볼 때 [`ROADMAP_NEXT.md`](./ROADMAP_NEXT.md) → 인덱스 [`ROADMAP.md`](./ROADMAP.md).

## 주요 파일 위치 (프런트)

- `web/src/components/memo/Workbench.tsx` — 줄 수 감소 중 (`WorkbenchEditor.tsx` 분리됨).
- `web/src/components/memo/WorkbenchSidebar.tsx`, `WorkbenchRightPanel.tsx`
- `web/src/components/memo/workbenchCommands.ts`, `workbenchTypes.ts`, `workbenchHelpers.ts`
- `web/src/components/memo/wikilinkExtension.ts`, `editor.ts`

## 운영 메모

- 프런트/백 로컬 + DB만 Docker 같은 구성을 썼음; Docker Desktop 꺼져 있으면 `docker` 명령 실패할 수 있음.
- **같은 채팅 탭 유지:** 워크스페이스만 `C:\Users\user\CloudMemo`로 열면 대화는 남을 수 있으나, 제품 동작은 버전마다 다를 수 있음. 확실히 하려면 이 파일 + 필요 시 `@파일` 참조.

## 이 파일을 업데이트할 때

- 큰 작업(커밋, 브랜치 전환, 레포 경로 재이동) 후 **한 줄이라도** 날짜·커밋·다음 할 일을 고칠 것.

---

*작성: 레포를 `C:\Users\user\CloudMemo`로 이동한 직후, 채팅 이어쓰기용.*
