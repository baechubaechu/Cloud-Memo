"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/app/providers";
import { MemoWorkbench } from "@/components/memo/Workbench";
import { offlineStore } from "@/lib/offlineStore";

export default function MemoPage() {
  const auth = useAuth() as { token: string | null; ready?: boolean; setToken: (t: string | null) => void };
  const token = auth.token;
  // 구버전 번들(provider에 ready가 없던 버전)과의 호환: undefined면 ready=true로 간주.
  const ready = auth.ready ?? true;
  const { setToken } = auth;
  const router = useRouter();

  // 이 기기에 노트를 보관하는 설정이면, 페이지를 새로 열 때마다 비밀번호로 보관소를
  // 풀어야 한다 (암호화 키는 메모리에만 둔다).
  const locked = ready && !!token && offlineStore.keepOnDevice() && !offlineStore.isUnlocked();

  useEffect(() => {
    if (!ready) return;
    if (!token || locked) {
      router.replace("/login");
    }
  }, [locked, ready, router, token]);

  // 토큰이 이미 있으면 ready와 무관하게 워크벤치 표시 (로그인 직후 레이스 방지).
  if (token && !locked) {
    return <MemoWorkbench token={token} onUnauthorized={() => setToken(null)} />;
  }

  if (!ready) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-ink-900/60">
        <p>인증 상태를 확인하는 중…</p>
      </div>
    );
  }

  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-ink-900/60">
      <p>로그인 페이지로 이동합니다…</p>
    </div>
  );
}
