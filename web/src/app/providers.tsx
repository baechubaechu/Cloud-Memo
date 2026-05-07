"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";

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

  // useLayoutEffect: 첫 페인트 전에 localStorage를 읽고 ready를 올려
  // 로그인 직후 /memo 로 넘어갈 때 `토큰은 있는데 ready만 false` 인 레이스를 줄인다.
  useLayoutEffect(() => {
    try {
      setTokenState(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      /* private mode 등 */
    } finally {
      setReady(true);
    }
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider 가 루트에 필요합니다.");
  return ctx;
}
