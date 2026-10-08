"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import { clearLegacyNoteCaches } from "@/lib/privacyCache";

type AuthCtx = {
  token: string | null;
  ready: boolean;
  setToken: (t: string | null) => void;
};

const AuthContext = createContext<AuthCtx | null>(null);

const STORAGE_KEY = "cloud_memo_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);

  // 이전 평문 캐시를 먼저 정리한 뒤 인증 상태를 공개한다.
  useLayoutEffect(() => {
    let cancelled = false;
    void clearLegacyNoteCaches().then(() => {
      if (cancelled) return;
      try {
        setTokenState(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        /* private mode 등 */
      } finally {
        setReady(true);
      }
    }).catch(() => {
      if (!cancelled) setPrivacyError(true);
    });
    const syncToken = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        setTokenState(window.localStorage.getItem(STORAGE_KEY));
      }
    };
    window.addEventListener("storage", syncToken);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", syncToken);
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      token,
      ready,
      setToken: (t) => {
        try {
          if (t) window.localStorage.setItem(STORAGE_KEY, t);
          else window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* noop */
        }
        setTokenState(t);
        setReady(true);
      },
    }),
    [ready, token],
  );

  if (privacyError) {
    return <p role="alert">이전 기기 캐시를 정리하지 못했습니다. 브라우저 저장소 접근을 허용한 뒤 새로고침해 주세요.</p>;
  }
  if (!ready) {
    return <p role="status">인증 상태를 확인하는 중...</p>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider 가 루트에 필요합니다.");
  return ctx;
}
