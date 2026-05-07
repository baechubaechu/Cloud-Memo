"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";

export function AuthenticatedImagePreview({
  attachmentId,
  token,
  caption,
}: {
  attachmentId: string;
  token: string;
  caption: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    (async () => {
      const resp = await fetch(api.attachmentThumbnailUrl(attachmentId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      revoke = url;
      setSrc(url);
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [attachmentId, token]);

  if (!src) return <div className="h-32 animate-pulse rounded-xl bg-ink-900/5" />;
  return (
    <figure className="space-y-1">
      <img src={src} alt={caption} className="w-full rounded-xl border border-ink-900/10 object-cover" />
      <figcaption className="text-[11px] text-ink-900/55">{caption}</figcaption>
    </figure>
  );
}
