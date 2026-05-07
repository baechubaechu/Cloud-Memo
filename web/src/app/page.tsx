"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("cloud_memo_token") : null;
    router.replace(token ? "/memo" : "/login");
  }, [router]);
  return (
    <div className="grid min-h-dvh place-items-center text-sm text-ink-900/65">
      <p>로딩 중…</p>
    </div>
  );
}
