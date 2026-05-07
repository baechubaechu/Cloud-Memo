"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import type { OverlayStroke, OverlayStrokeTool } from "@/lib/api";

export type OverlayDrawingTool = OverlayStrokeTool | "eraser";

export interface OverlayDrawingLayerHandle {
  undo(): void;
  redo(): void;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

interface Props {
  /**
   * 그리기 모드. false 면 SVG 가 pointer-events: none 이라 입력이 그대로
   * 아래의 에디터로 통과한다.
   */
  enabled: boolean;
  tool: OverlayDrawingTool;
  color: string;
  /** stroke 굵기(논리 px). highlighter 는 보통 두껍게 들어감. */
  width: number;
  /** 본문 텍스트 영역 안에 부유하는 stroke 들. */
  strokes: OverlayStroke[];
  /** stroke 가 추가/지워질 때마다 호출. 자동 저장 측에서 디바운스 처리. */
  onStrokesChange: (next: OverlayStroke[]) => void;
}

/**
 * 본문(에디터) 영역 위에 떠 있는 자유 그림 레이어.
 *
 * 좌표계
 *   - 그릴 때: 컴포넌트의 좌상단(0,0) 기준 CSS 픽셀로 저장.
 *   - 다시 그릴 때: stroke.captureWidth 와 현재 가로폭 비율로 x 만 스케일.
 *     세로 줄바꿈 양상이 폭에 따라 달라지므로 v1 에서는 y 는 그대로 둔다.
 *
 * pointer-events 정책
 *   - enabled=false: 레이어 전체가 pointer-events: none → 아래 에디터가 정상.
 *   - enabled=true:  레이어가 입력을 가로채서 펜/지우개로 그림.
 *
 * undo/redo
 *   - 컴포넌트 내부에 history stack 을 유지하고, ref 로 외부 도구 모음에 노출.
 *   - 외부에서 strokes prop 이 바뀌면(다른 노트 로드, 서버 응답 등) history 를
 *     초기화한다.
 */
export const OverlayDrawingLayer = forwardRef<OverlayDrawingLayerHandle, Props>(
  function OverlayDrawingLayer(
    { enabled, tool, color, width, strokes, onStrokesChange },
    ref,
  ) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });

    // 진행 중인 stroke 는 별도 state. 마우스/펜이 떼질 때 onStrokesChange 로 커밋.
    const [draftStroke, setDraftStroke] = useState<OverlayStroke | null>(null);
    const draftRef = useRef<OverlayStroke | null>(null);

    // undo/redo: 외부에서 strokes 가 바뀌면 history 초기화.
    const undoStackRef = useRef<OverlayStroke[][]>([]);
    const redoStackRef = useRef<OverlayStroke[][]>([]);
    const lastStrokesIdRef = useRef<string>("");
    useEffect(() => {
      // strokes 가 외부 요인으로 통째로 갈렸는지(노트 전환 등) 가벼운 식별자
      // 로 추적한다. 동일한 ref 라면 history 를 보존.
      const sig = strokesSignature(strokes);
      if (sig !== lastStrokesIdRef.current) {
        lastStrokesIdRef.current = sig;
        undoStackRef.current = [];
        redoStackRef.current = [];
      }
    }, [strokes]);

    useEffect(() => {
      const el = wrapperRef.current;
      if (!el) return;
      const update = () => {
        const r = el.getBoundingClientRect();
        setSize({ w: r.width, h: r.height });
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    useImperativeHandle(ref, () => ({
      undo() {
        const prev = undoStackRef.current.pop();
        if (!prev) return;
        redoStackRef.current.push(strokes);
        lastStrokesIdRef.current = strokesSignature(prev);
        onStrokesChange(prev);
      },
      redo() {
        const next = redoStackRef.current.pop();
        if (!next) return;
        undoStackRef.current.push(strokes);
        lastStrokesIdRef.current = strokesSignature(next);
        onStrokesChange(next);
      },
      clear() {
        if (strokes.length === 0) return;
        undoStackRef.current.push(strokes);
        redoStackRef.current = [];
        const empty: OverlayStroke[] = [];
        lastStrokesIdRef.current = strokesSignature(empty);
        onStrokesChange(empty);
      },
      canUndo: () => undoStackRef.current.length > 0,
      canRedo: () => redoStackRef.current.length > 0,
    }));

    const pushHistory = (before: OverlayStroke[]) => {
      undoStackRef.current.push(before);
      // 새 액션이 들어오면 redo 는 무효.
      redoStackRef.current = [];
      // 너무 길어지지 않게.
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    };

    const localPoint = (clientX: number, clientY: number): [number, number] => {
      const wrap = wrapperRef.current;
      if (!wrap) return [0, 0];
      const r = wrap.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top];
    };

    const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!enabled) return;
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      ev.preventDefault();
      const [x, y] = localPoint(ev.clientX, ev.clientY);
      const captureWidth = size.w || 1;
      if (tool === "eraser") {
        const target = findStrokeAt(strokes, x, y, size.w);
        if (target) {
          pushHistory(strokes);
          const next = strokes.filter((s) => s.id !== target.id);
          lastStrokesIdRef.current = strokesSignature(next);
          onStrokesChange(next);
        }
        // 지우개도 드래그하면서 연속해서 지울 수 있게 capture.
        svgRef.current?.setPointerCapture(ev.pointerId);
        draftRef.current = null;
        setDraftStroke(null);
        return;
      }

      const pressure = ev.pressure && ev.pressure > 0 ? ev.pressure : 0.5;
      const stroke: OverlayStroke = {
        id: cryptoRandomId(),
        tool,
        color,
        width: tool === "highlighter" ? Math.max(width, 8) : width,
        opacity: tool === "highlighter" ? 0.32 : 1,
        captureWidth,
        points: [[round(x), round(y)]],
      };
      // 압력은 v1 에선 stroke 단위로만 한 번 반영(향후 per-point 로 확장).
      stroke.width = Math.max(1, stroke.width * (0.6 + pressure * 0.6));
      draftRef.current = stroke;
      setDraftStroke(stroke);
      svgRef.current?.setPointerCapture(ev.pointerId);
    };

    const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!enabled) return;
      const [x, y] = localPoint(ev.clientX, ev.clientY);
      if (tool === "eraser") {
        // 버튼이 눌려있을 때만 연속 지우기.
        if ((ev.buttons & 1) === 0 && ev.pointerType === "mouse") return;
        const target = findStrokeAt(strokes, x, y, size.w);
        if (target) {
          // 이미 지우는 동작이 한 번 시작되면 더 push 하지 않음(연속 지우기를
          // 한 묶음의 undo 로 보고 싶지만 단순화).
          const next = strokes.filter((s) => s.id !== target.id);
          lastStrokesIdRef.current = strokesSignature(next);
          onStrokesChange(next);
        }
        return;
      }
      const draft = draftRef.current;
      if (!draft) return;
      const last = draft.points[draft.points.length - 1];
      // 너무 촘촘한 점은 줄여서 path 길이 절약.
      if (last && Math.abs(last[0] - x) < 1 && Math.abs(last[1] - y) < 1) return;
      const next: OverlayStroke = {
        ...draft,
        points: [...draft.points, [round(x), round(y)]],
      };
      draftRef.current = next;
      setDraftStroke(next);
    };

    const commitDraft = () => {
      const draft = draftRef.current;
      draftRef.current = null;
      setDraftStroke(null);
      if (!draft) return;
      // 점 1개짜리는 무시.
      if (draft.points.length < 2) return;
      pushHistory(strokes);
      const next = [...strokes, draft];
      lastStrokesIdRef.current = strokesSignature(next);
      onStrokesChange(next);
    };

    const onPointerUp = (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!enabled) return;
      svgRef.current?.releasePointerCapture(ev.pointerId);
      commitDraft();
    };

    const onPointerCancel = () => {
      draftRef.current = null;
      setDraftStroke(null);
    };

    const scaleX = useMemo(() => {
      // stroke 별 captureWidth 는 다를 수 있으니 렌더 단계에서 stroke 마다 계산.
      return size.w;
    }, [size.w]);

    const all = useMemo(() => (draftStroke ? [...strokes, draftStroke] : strokes), [strokes, draftStroke]);

    return (
      <div
        ref={wrapperRef}
        className="memo-overlay-layer pointer-events-none absolute inset-0"
      >
        <svg
          ref={svgRef}
          className={`absolute inset-0 h-full w-full ${enabled ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{
            cursor: enabled ? (tool === "eraser" ? "cell" : "crosshair") : "auto",
            touchAction: enabled ? "none" : "auto",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {all.map((s) => (
            <path
              key={s.id}
              d={pathFromStroke(s, scaleX)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={s.opacity ?? 1}
              style={s.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
            />
          ))}
        </svg>
      </div>
    );
  },
);

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function strokesSignature(strokes: OverlayStroke[]): string {
  // history 무효화 판단용. 길이 + 마지막 id 정도만 보면 충분.
  if (strokes.length === 0) return "[]";
  return `${strokes.length}:${strokes[strokes.length - 1].id}`;
}

function pathFromStroke(s: OverlayStroke, currentWidth: number): string {
  if (s.points.length === 0) return "";
  const sx = s.captureWidth > 0 ? currentWidth / s.captureWidth : 1;
  const px = (x: number) => x * sx;
  const py = (y: number) => y;
  if (s.points.length === 1) {
    const [x, y] = s.points[0];
    return `M ${px(x)} ${py(y)} L ${px(x)} ${py(y)}`;
  }
  // Catmull-Rom 스무딩 → bezier 변환. 점 사이 곡률을 좀 부드럽게.
  const pts = s.points;
  let d = `M ${px(pts[0][0])} ${py(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${px(cp1x)} ${py(cp1y)}, ${px(cp2x)} ${py(cp2y)}, ${px(p2[0])} ${py(p2[1])}`;
  }
  return d;
}

function findStrokeAt(
  strokes: OverlayStroke[],
  x: number,
  y: number,
  currentWidth: number,
): OverlayStroke | undefined {
  // 끝쪽(맨 위에 그려진 것)부터 검사 → 최신 stroke 가 우선 지워짐.
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const s = strokes[i];
    const sx = s.captureWidth > 0 ? currentWidth / s.captureWidth : 1;
    const tol = Math.max(6, s.width / 2 + 6);
    for (let p = 0; p < s.points.length - 1; p += 1) {
      const ax = s.points[p][0] * sx;
      const ay = s.points[p][1];
      const bx = s.points[p + 1][0] * sx;
      const by = s.points[p + 1][1];
      if (distanceToSegment(x, y, ax, ay, bx, by) <= tol) return s;
    }
    if (s.points.length === 1) {
      const ax = s.points[0][0] * sx;
      const ay = s.points[0][1];
      const dx = ax - x;
      const dy = ay - y;
      if (dx * dx + dy * dy <= tol * tol) return s;
    }
  }
  return undefined;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}
