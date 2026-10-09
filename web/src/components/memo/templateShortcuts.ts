export function templateShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code" | "isComposing" | "keyCode">): string | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (!(event.ctrlKey || event.metaKey) || !event.altKey) return null;
  if (!/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) return null;
  return `Mod+Alt+${event.shiftKey ? "Shift+" : ""}${event.code}`;
}

export function shortcutLabel(shortcut: string | null): string {
  return shortcut?.replace("Mod", "Ctrl/Cmd").replace(/Key|Digit/g, "") ?? "";
}
