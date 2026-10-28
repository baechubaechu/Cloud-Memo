// 명령 팔레트 (Ctrl/Cmd+K, Ctrl/Cmd+P): 열림 상태, 검색어, 열릴 때 입력칸 포커스, 검색어로
// 명령 거르기. 명령 목록은 호출하는 쪽이 만든다. Workbench 에서 분리.

import { useEffect, useRef, useState } from "react";
import type { AppCommand } from "./workbenchTypes";

type Options = {
  /** 다른 대화상자가 떠 있으면 단축키로 열지 않는다. */
  suspended: boolean;
};

export function useCommandPalette({ suspended }: Options) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (suspended || ev.isComposing || ev.keyCode === 229) return;
      if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === "k" || ev.key.toLowerCase() === "p")) {
        ev.preventDefault();
        setQuery("");
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [suspended]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  /** 검색어가 제목·설명·키워드 어디에든 들어 있는 명령만. */
  function filter(commands: AppCommand[]): AppCommand[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((cmd) => `${cmd.title} ${cmd.description} ${cmd.keywords}`.toLowerCase().includes(needle));
  }

  function close() {
    setOpen(false);
  }

  function run(cmd: AppCommand) {
    setOpen(false);
    setQuery("");
    cmd.run();
  }

  return { open, query, setQuery, inputRef, filter, close, run };
}
