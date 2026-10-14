// 음성 녹음 (MediaRecorder). 녹음이 끝나면 파일 하나로 만들어 onRecorded 로 넘긴다.
// Workbench 에서 분리 — 녹음 상태는 다른 편집 상태와 얽히지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  /** 녹음이 끝나 만들어진 파일. 항상 최신 콜백을 부른다(녹음 중 노트를 바꿨다면 바뀐 노트). */
  onRecorded: (file: File) => void | Promise<void>;
  /** 브라우저가 녹음을 지원하지 않을 때 보여줄 문구. */
  onUnsupported: (message: string) => void;
  /** 마이크 권한 거부 등 녹음 시작 실패. */
  onError: (error: unknown) => void;
};

export function useAudioRecorder({ onRecorded, onUnsupported, onError }: Options) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const callbacksRef = useRef({ onRecorded, onUnsupported, onError });
  callbacksRef.current = { onRecorded, onUnsupported, onError };

  const releaseStream = () => {
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
  };

  // 페이지를 떠나면 진행 중인 녹음 스트림을 반드시 정리.
  useEffect(() => {
    return () => {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* noop */
      }
      releaseStream();
      mediaRecorderRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (mediaRecorderRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      callbacksRef.current.onUnsupported("이 브라우저는 음성 녹음을 지원하지 않습니다.");
      return;
    }
    if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
      callbacksRef.current.onUnsupported("이 브라우저는 MediaRecorder를 지원하지 않습니다.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      // 가능한 mime 우선순위 (브라우저별 호환).
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        releaseStream();
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (chunks.length === 0) return;
        const blobType = rec.mimeType || "audio/webm";
        const ext = blobType.includes("mp4") ? "m4a" : blobType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks, { type: blobType });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        await callbacksRef.current.onRecorded(new File([blob], `recording-${ts}.${ext}`, { type: blobType }));
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setIsRecording(true);
    } catch (e) {
      callbacksRef.current.onError(e);
      releaseStream();
    }
  }, []);

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* noop */
    }
  }, []);

  return { isRecording, start, stop };
}
