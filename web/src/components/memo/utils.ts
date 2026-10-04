import type { NoteVersion } from "@/lib/api";

export const REASON_LABEL: Record<NoteVersion["reason"], string> = {
  manual: "수동 저장",
  before_delete: "삭제 직전",
  before_ai_edit: "AI 수정 직전",
  restore: "복원 직전",
  periodic_autosave: "하루 스냅샷",
  before_merge: "동기화 병합 직전",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(1)} ${u[i]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 이름 정렬 우선순위: 숫자(0) → ASCII 영문(1) → 한글(2) → 그 외(3)
export function nameRank(s: string): number {
  if (!s) return 4;
  const c = s.codePointAt(0) ?? 0;
  if (c >= 0x30 && c <= 0x39) return 0;
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return 1;
  if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e)) return 2;
  return 3;
}

// 같은 카테고리 안에서는 자연 정렬(ko 로케일, 숫자 부분은 숫자로 비교)
export function compareName(a: string, b: string): number {
  const ra = nameRank(a);
  const rb = nameRank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" });
}

export const DND_MIME_NOTE = "application/x-memo-note";
export const DND_MIME_NOTE_MULTI = "application/x-memo-note-multi";
export const DND_MIME_FOLDER = "application/x-memo-folder";

/** dragover에서는 getData 불가할 수 있으므로 types 배열만 검사한다. */
export function dndHasMime(dt: DataTransfer | null | undefined, mime: string): boolean {
  if (!dt?.types) return false;
  const types = dt.types as unknown as Iterable<string>;
  for (const t of types) {
    if (t === mime) return true;
  }
  return false;
}
