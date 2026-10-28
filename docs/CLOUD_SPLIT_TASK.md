# 클라우드 세션 작업 지시 — `Workbench.tsx` 나누기

브랜치 `refactor/workbench-split` 에서 이어서 한다. `main` 에는 합치지 않는다 (병합은 사용자가 로컬에서
브라우저 확인 후 결정).

## 목표

`web/src/components/memo/Workbench.tsx` (현재 약 2800줄) 의 상태·로직을 커스텀 훅으로 옮긴다.
이미 끝난 첫 단계: `useAudioRecorder.ts`, `useSlashMenu.ts` (커밋 `908a579` 참고 — 같은 스타일로).

남은 순서 (`docs/ROADMAP_TECH.md` "구조 — 큰 파일 나누기" 절):

1. 백링크 — 백링크 패널 상태·조회 (`useBacklinks`)
2. 동기화 — 폴링 루프, `handleSyncChanges`, `applyRemoteNote`, `refreshCache`, 오프라인/온라인 전환 (`useNoteSync`)
3. 자동 저장 — `flushDraftForNote`, `baseRef`·`lastSentRef`, 재시도, `pushPendingDrafts`, 그림 저장 (`useAutosave`). 가장 얽혀 있음.
4. 사이드바 트리 — 폴더·노트 이동/이름 변경/삭제, DnD, 멀티선택 (`useSidebarTree`)
5. 오프라인 목록 만들기(사본 → 목록 필터)는 순수 함수로 `workbenchHelpers.ts` 에.

## 규칙

- **동작을 바꾸지 않는 이동만.** 버그를 발견해도 고치지 말고 기록만 한다 (마지막 보고에 포함).
- **훅 하나 = 커밋 하나.** 커밋 메시지는 기존 형식 `refactor(memo): ...`.
- ref 와 클로저 의존이 많다. 훅으로 옮길 때 `useCallback`/`useEffect` 의존성 배열, ref 를 넘기는지
  값을 넘기는지 바뀌지 않게 주의. 특히 자동 저장은 `document.activeElement`·`titleInputRef` 로
  링크 갱신 시점을 정하므로 그대로 유지.
- 3단계(자동 저장)가 너무 얽혀 안전하게 못 옮기겠으면 거기서 멈추고 이유를 보고한다. 억지로 하지 않는다.
- 코드 스타일은 주변 코드에 맞춘다 (주석 밀도·이름·한글 주석).
- `docs/ROADMAP*.md` 는 수정하지 않는다. 마지막에 `docs/CHAT_HANDOFF.md` 의 "진행 중" 문단만 결과로 갱신.

## 개인정보 — 반드시 지킬 것

- 실제 VPS·운영 DB 주소나 비밀번호를 찾거나 쓰지 않는다. 로컬 테스트 DB(`memo/memo`, 비밀번호 `1234`)만 쓴다.
- 테스트 데이터는 테스트 스크립트가 만든 것만. 외부 서비스로 데이터 전송 금지.

## 환경 준비 (처음 한 번)

```bash
bash scripts/dev-linux.sh setup
bash scripts/dev-linux.sh up
```

## 단계마다 검증

```bash
bash scripts/dev-linux.sh test     # 오프라인 테스트 + 실제 API 테스트 (up 상태에서)
cd web && npx tsc --noEmit
```

단계를 모두 마친 뒤 한 번:

```bash
bash scripts/dev-linux.sh down
bash scripts/dev-linux.sh check    # 타입 검사 + 프로덕션 빌드
```

프런트 테스트가 없으므로, 가능하면 헤드리스 브라우저(Playwright 등)로 `http://localhost:3000` 에서
노트 열기·본문 입력 후 저장·노트 전환·제목 변경 정도를 확인한다. 안 되면 건너뛰고 보고에 적는다.

## 끝나면

- 브랜치에 푸시 (`git push origin refactor/workbench-split`).
- 보고: 단계별 커밋, `Workbench.tsx` 줄 수 변화, 통과한 검증, 건너뛴 검증, 발견했지만 고치지 않은 문제,
  사용자가 로컬 브라우저에서 꼭 확인해야 할 항목 (저장·전환·동기화·오프라인·백링크·드래그).
