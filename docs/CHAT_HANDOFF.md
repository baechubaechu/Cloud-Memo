# 채팅 이어하기 / 세션 핸드오프

이 파일은 **레포 경로를 옮긴 뒤에도** 새 채팅방에서 맥락을 복구하기 위해 남긴 요약이다.
새 대화를 열면 `@docs/CHAT_HANDOFF.md` 또는 이 파일 내용을 붙여 넣어도 된다.

## 레포 위치 (현재)

- **경로:** `C:\Users\user\CloudMemo` (이전: `.cursor\projects\empty-window\cloud-memo` 에서 이동)
- **브랜치:** `main`
- **리뷰 기준 커밋:** `3813b28` (2026-10-04, 백링크 서버 조회·깨진 링크·줄 이동).
- **컨텍스트 재정리:** 2026-10-08 — 지난 확인 기준 `15c0457` 이후 Claude 공동 작성
  커밋 6개와 관련 코드를 읽음. 이번 정리는 코드·문서 확인이며, 앱 실행 검증은 하지 않음.
- **후속 수정:** 2026-10-08 — 초안 저장 완료 확인, 다중 탭 보관소 삭제·로그아웃,
  이전 평문 캐시 정리, 백링크 공백 처리. 회귀 검증 명령:
  `node scripts/test_device_storage.cjs`, `api/.venv/Scripts/python.exe scripts/test_backlinks.py`.
  모의 저장소·격리 DB 테스트이며 실제 브라우저 점검을 대신하지 않는다.
  두 회귀 테스트·타입 검사·프로덕션 빌드 통과. 다음은 실제 브라우저에서 저장·다중 탭
  로그아웃·기기 보관·오프라인 재연결을 확인하고, 오프라인 앱 셸 구현으로 진행.
- **추가 개발:** 같은 사용자·폴더 내 노트 이름 중복 방지와 무제 노트 자동 번호
  배정. 실제 API 회귀 테스트는 `python scripts/test_note_names.py`(httpx 설치 환경).
  생성·이름 변경·이동·복원·폴더 삭제, 동시 생성·이름 변경 검증. 기존 중복 이름은 보존.
  사용자 보고상 백링크 포함 주요 브라우저 동작 정상, 오프라인은 미확인.
  중복 제목 입력 중 경고 유지, 편집 확정 시 사용 가능한 무제 노트 이름으로 변경.
  사용자 확인 후 커밋. 다음 점검은 기기 보관을 켠 상태의 오프라인 편집·재연결 저장.

## 다음 세션 시작점

새 작업 전에 [`ROADMAP_NEXT.md`](./ROADMAP_NEXT.md) 맨 위 **「다음에 켜자마자 — 브라우저로 직접
확인」** 목록부터 본다 (자동 저장·동기화·오프라인을 사람이 직접 확인).

## 최신 개발 맥락 (2026-10-08 정리)

### 지난 확인 이후 커밋

| 커밋 | 변경 | 이어받을 때 알아둘 점 |
|------|------|----------------------|
| `42754d6` | 브라우저 직접 점검에서 발견한 문제 수정 | 제목 한글 조합 중 저장, 렌더된 줄·여백의 파일 드롭, 첨부 제거 시 본문 마커 줄 정리, 새 노트 포커스 가드 해제. CodeMirror의 `basicSetup`·본문 변경 콜백 참조도 고정. |
| `8f2ed7e` | 버전 정책 변경 | 수동 체크포인트 UI/API 및 관련 설정 제거. 7일 보관 도입. 처음에는 하루 간격이었음. |
| `82f6e6d` | 버전 간격 재변경 | 최종 정책은 **편집 시 1시간 간격**으로 수정 직전 제목·본문 보관. 병합·복원·AI 적용 직전에는 강제 스냅샷. 첨부·그림은 버전에 복제하지 않음. 오래된 버전은 새 스냅샷을 쓸 때 정리. |
| `8742d55` | 백링크 패널 초안, 사본 버전 색인 | 초기 커밋은 미검증 WIP. `seqs`에 노트 id·`change_seq`를 별도 보관해 동기화 비교 때 전체 본문 복호화를 피함. 후속 `3813b28`까지 함께 봐야 함. |
| `f8301c4` | 기기 보관 선택·암호화 | 로그인에서 기기 보관을 선택. 기본 꺼짐, 선택 시 AES-GCM 256 + PBKDF2 60만 회. 키는 메모리에만 유지. API `no-store` 및 서비스 워커의 API·다른 출처 응답 캐시 금지. |
| `3813b28` | 백링크 후속 구현 | 사본 보관 기기는 로컬에서 계산, 그 외에는 `GET /api/notes/{id}/backlinks`. 깨진 외부 방향 위키링크 표시, 백링크·할 일 클릭 시 해당 줄 이동. |

### 유지할 동작과 제한

- 원본은 사용자 소유 서버의 PostgreSQL·첨부 파일. 제3자 동기화 저장소를 쓰지 않는다.
- 동기화는 노트 `revision`과 서버 3-way 텍스트 병합, 보이는 탭에서 3초 폴링.
  편집 중이거나 한글 조합 중이면 원격 본문 교체를 미루고 다음 저장에서 병합한다.
- **기기 보관은 자동 동기화 토글과 다르다.** 보관을 꺼도 온라인 저장·동기화는 동작한다.
  꺼진 상태에서는 초안·사본의 영속 저장이 없으므로 오프라인에서 탭을 닫은 뒤 복구를 보장하지 않는다.
- 보관을 켠 기기는 새로고침·다시 열기 때 비밀번호로 잠금을 해제한다. 개발 자동 로그인은
  잠금도 풀 수 있으므로 검증 시 개발 모드 동작을 고려한다.
- 로그아웃·보관 끄기는 **못 보낸 초안까지** 삭제한다. 이전의 "로그아웃 후 초안 유지" 설명은 폐기됨.
- 첨부는 기기에 오프라인 사본을 저장하지 않는다. 그림 레이어의 오프라인 보관·병합도 미구현.
- 백링크·할 일의 줄 이동은 구현됐지만, 할 일 패널의 노트별 조회(N+1)는 여전히 남아 있다.

### 확인 상태와 다음 순서

2026-10-04 직접 점검 기록상 통과: 노트 전환 후 Ctrl+Z, 버전 복원, 태그 생성,
노트 삭제, 3초 안 원격 변경 반영, 본문 한글 자동 저장.

추가 확인 필요: 수정 후 제목·본문 한글 입력, 이미지 붙여넣기·드롭, 첨부 제거,
커서 사라짐 재현, 두 기기 동시 편집·IME 중 원격 변경, 실제 오프라인 재연결·삭제된
노트 초안 복구, 기기 보관 선택·잠금·로그아웃 정리. 백링크 완료 표시는 구현 상태이며
이번 세션에서 브라우저 동작을 새로 검증한 것은 아니다.

1. 위 직접 점검을 마치고 발견한 문제 수정.
2. 오프라인 앱 셸 실행 → 작업 큐(생성·삭제·폴더 등) → 그림·첨부 보관.
3. 사용자 지정 단축키·도움말, 할 일 모음 API.
4. 리스트 정렬, 글자 수·읽기 시간, 단일 노트 export, Obsidian import, 다크 모드.
5. 자동 동기화 토글·수동 동기화·허브 연결 화면 및 장기 앱·위젯·AI 기능.

문서 주의: `ROADMAP_NEXT.md`에는 버전 복원 통과 기록이 있지만 하단과
`ROADMAP_TECH.md`에는 미확인 표시가 남아 있다. 큰 파일 줄 수도 10월 3일 기준이다.
따라서 완료 여부는 날짜가 붙은 확인 기록과 현재 코드를 함께 보고 판단한다.

### 최신 변경의 주요 파일

- `web/src/lib/offlineStore.ts` — 암호화 사본·초안·메타데이터, 잠금, 삭제, 버전 색인.
- `web/src/app/login/page.tsx`, `web/src/app/memo/page.tsx` — 보관 선택·잠금 해제·접근 가드.
- `web/src/components/memo/Workbench.tsx` — 자동 저장·동기화·사본 갱신·백링크·줄 이동.
- `web/src/components/memo/WorkbenchEditor.tsx`, `WorkbenchRightPanel.tsx` — 드롭 처리·패널 UI.
- `api/app/routers/notes.py` — 백링크 API, 저장·병합·버전 복원.
- `api/app/services/versions.py` — 시간별 스냅샷·7일 보관 정책.
- `api/app/main.py`, `web/next.config.ts` — 응답·서비스 워커 캐시 정책.

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
