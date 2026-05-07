"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/app/providers";

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
    if (token) {
      router.replace("/memo");
      return;
    }
    if (autoTriedRef.current) return;
    if (!DEV_PASSWORD) return;
    autoTriedRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        const res = await api.login(DEV_PASSWORD);
        setToken(res.access_token);
        router.replace("/memo");
      } catch (e: unknown) {
        if (e instanceof ApiError) setError(typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload));
        else setError(String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [mounted, ready, router, setToken, token]);

  useEffect(() => {
    if (!ready) return;
    if (!mounted) return;
    if (!DEV_AUTOLOGIN && token) {
      router.replace("/memo");
    }
  }, [mounted, ready, router, token]);

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(password);
      setToken(res.access_token);
      router.replace("/memo");
    } catch (e: unknown) {
      if (e instanceof ApiError) setError(typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload));
      else setError(String(e));
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
          <h1 className="text-2xl font-semibold tracking-tight">로그인</h1>
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
