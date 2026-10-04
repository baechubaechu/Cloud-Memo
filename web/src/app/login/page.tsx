"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/app/providers";
import { offlineStore } from "@/lib/offlineStore";

// 로컬 개발 전용 자동 로그인 플래그.
// next.js는 NEXT_PUBLIC_* 환경변수를 빌드 타임에 인라이닝하므로,
// 프로덕션 빌드(=docker compose build)에서 이 값이 비어 있으면 절대 켜지지 않습니다.
const DEV_AUTOLOGIN = process.env.NEXT_PUBLIC_DEV_AUTOLOGIN === "1";
const DEV_PASSWORD = process.env.NEXT_PUBLIC_DEV_PASSWORD || "";

export default function LoginPage() {
  const auth = useAuth() as { token: string | null; ready?: boolean; setToken: (t: string | null) => void };
  const token = auth.token;
  const ready = auth.ready ?? true;
  const { setToken } = auth;
  const router = useRouter();

  // SSR/CSR 일관성을 위해 dev 전용 값들은 마운트 후에만 적용한다.
  // (이전 도커 빌드에서 등록된 서비스 워커가 옛 JS 번들을 캐시해 살리는
  //  케이스에서도 hydration mismatch가 안 나게 하기 위함)
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  const autoTriedRef = useRef(false);
  // 이 기기에 노트를 (암호화해서) 보관할지. 기본은 꺼짐.
  const [keep, setKeep] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 보관이 켜진 기기는 페이지를 새로 열 때마다 비밀번호로 보관소 잠금을 풀어야 한다.
  const needsUnlock = mounted && offlineStore.keepOnDevice() && !offlineStore.isUnlocked();

  useEffect(() => {
    setKeep(offlineStore.keepOnDevice());
    void offlineStore.purgeIfDisabled();
  }, []);

  /**
   * 비밀번호 확인 → (켜져 있으면) 기기 보관소 잠금 해제 → 메모 화면으로.
   * 서버에 닿지 않아도, 이 기기에 보관소가 있고 비밀번호가 맞으면 오프라인으로 들어간다.
   */
  const signIn = async (pw: string, keepHere: boolean): Promise<void> => {
    let newToken: string | null = null;
    try {
      newToken = (await api.login(pw)).access_token;
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload));
        return;
      }
      if (!(token && offlineStore.keepOnDevice())) {
        setError("서버에 연결할 수 없습니다.");
        return;
      }
    }
    const verified = newToken !== null;
    if (verified) await offlineStore.setKeepOnDevice(keepHere);
    if (offlineStore.keepOnDevice()) {
      const result = await offlineStore.unlock(pw, verified);
      if (result === "wrong") {
        setError("비밀번호가 맞지 않아 이 기기의 보관소를 열 수 없습니다.");
        return;
      }
      if (result === "unsupported") {
        // 암호화를 쓸 수 없는 환경(HTTP 로 접속한 경우 등)에서는 기기에 남기지 않는다.
        await offlineStore.setKeepOnDevice(false);
        setNotice("이 접속 환경에서는 암호화 보관을 쓸 수 없어 기기에 저장하지 않습니다.");
      }
    }
    if (newToken) setToken(newToken);
    router.replace("/memo");
  };

  // 마운트 직후: dev 전용 ServiceWorker/캐시 정리 + 자격증명 프리필.
  useEffect(() => {
    setMounted(true);
    if (!DEV_AUTOLOGIN) return;

    // 옛 PWA SW가 살아있으면 즉시 해제 (로컬 dev에서는 SW를 안 씀)
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          for (const r of regs) void r.unregister();
        })
        .catch(() => {});
    }
    if (typeof window !== "undefined" && "caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }

    if (DEV_PASSWORD) setPassword(DEV_PASSWORD);
  }, []);

  // 자동 로그인은 마운트 + dev 모드 + 토큰 없을 때만 1회 시도.
  useEffect(() => {
    if (!ready) return;
    if (!mounted) return;
    if (!DEV_AUTOLOGIN) return;
    if (token && !needsUnlock) {
      router.replace("/memo");
      return;
    }
    if (autoTriedRef.current) return;
    if (!DEV_PASSWORD) return;
    // 방금 직접 로그아웃했으면 자동으로 다시 들어가지 않는다 (보관 설정을 고를 수 있게).
    try {
      if (window.sessionStorage.getItem("cloud_memo_skip_autologin") === "1") {
        window.sessionStorage.removeItem("cloud_memo_skip_autologin");
        autoTriedRef.current = true;
        return;
      }
    } catch {
      /* noop */
    }
    autoTriedRef.current = true;
    setBusy(true);
    void signIn(DEV_PASSWORD, offlineStore.keepOnDevice()).finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, needsUnlock, ready, router, token]);

  useEffect(() => {
    if (!ready) return;
    if (!mounted) return;
    if (!DEV_AUTOLOGIN && token && !needsUnlock) {
      router.replace("/memo");
    }
  }, [mounted, needsUnlock, ready, router, token]);

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signIn(password, keep);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // dev 전용 UI 노출 여부 — 마운트 이후에만 true가 될 수 있음 → SSR/CSR 일관성 보장
  const showDevBanner = mounted && DEV_AUTOLOGIN;

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-pane ring-1 ring-ink-900/10">
        <header className="space-y-1 pb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-900/45">Cloud Memo</p>
          <h1 className="text-2xl font-semibold tracking-tight">{needsUnlock ? "잠금 해제" : "로그인"}</h1>
          <p className="text-sm text-ink-900/60">
            초기 사용자는 Compose 환경 변수 <code className="font-mono text-xs">INITIAL_*</code> 로 부트스트랩됩니다.
          </p>
          {showDevBanner ? (
            <p className="text-xs text-amber-700">
              로컬 개발 모드: 자동 로그인 활성화 (단일 비밀번호)
            </p>
          ) : null}
        </header>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-ink-900/80">비밀번호</span>
            <input
              type="password"
              className="block w-full rounded-xl border border-ink-900/12 bg-white px-3 py-2 text-[15px] shadow-sm outline-none focus:border-sky-500"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={keep}
              onChange={(e) => setKeep(e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink-900/80">이 기기에 노트 보관 (오프라인 사용)</span>
              <span className="block text-xs text-ink-900/55">
                내 기기에서만 켜세요. 노트 사본을 이 기기에 암호화해서 저장하고, 열 때마다 비밀번호를
                묻습니다. 꺼 두면 이 기기에는 아무것도 남지 않습니다.
              </span>
            </span>
          </label>
          {notice ? <p className="text-xs text-amber-700">{notice}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              로그인에 실패했습니다. {error}
            </p>
          ) : null}

          <button
            disabled={busy}
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
          >
            {busy ? "확인 중…" : "계속하기"}
          </button>
          <Link href="/manifest.json" prefetch={false} className="block text-center text-xs text-sky-700 underline underline-offset-2">
            매니페스트 열기
          </Link>
        </form>
      </div>
    </div>
  );
}
