import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function Base({ size = 16, children, ...rest }: IconProps & { children: ReactElement | ReactElement[] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Base>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Base>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m9 6 6 6-6 6" />
    </Base>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  );
}

export function IconFolder(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </Base>
  );
}

export function IconFolderOpen(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7Z" />
      <path d="m3 9 2.2 8.4A2 2 0 0 0 7.1 19h11a2 2 0 0 0 1.9-1.4L22 9H3Z" />
    </Base>
  );
}

export function IconFile(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </Base>
  );
}

export function IconStar(p: IconProps & { filled?: boolean }) {
  const { filled, ...rest } = p;
  return (
    <Base {...rest} fill={filled ? "currentColor" : "none"}>
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6-5.4-2.9L6.6 19.8l1-6L3.2 9.5l6.1-.9L12 3Z" />
    </Base>
  );
}

export function IconArchive(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </Base>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Base>
  );
}

export function IconSave(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M7 3v6h9V3" />
      <path d="M7 14h10" />
      <path d="M7 18h7" />
    </Base>
  );
}

export function IconPaperclip(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l8-8" />
    </Base>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Base>
  );
}

export function IconX(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </Base>
  );
}

export function IconLogOut(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Base>
  );
}

export function IconList(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Base>
  );
}

export function IconSidebarToggle(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 7v10" />
    </Base>
  );
}

export function IconHash(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M5 9h14" />
      <path d="M5 15h14" />
      <path d="M10 4 8 20" />
      <path d="M16 4l-2 16" />
    </Base>
  );
}

export function IconFolderPlus(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M12 11v6" />
      <path d="M9 14h6" />
    </Base>
  );
}

export function IconFilePlus(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M12 12v6" />
      <path d="M9 15h6" />
    </Base>
  );
}

export function IconImage(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5L5 20" />
    </Base>
  );
}

export function IconMic(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Base>
  );
}

export function IconStop(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Base>
  );
}

export function IconMusic(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M9 18V6l11-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </Base>
  );
}

export function IconBrush(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M9.06 11.9 8 13l-3 3 3 3 3-3 1.1-1.1" />
      <path d="m20 4-9.7 9.7 3 3L20 7z" />
    </Base>
  );
}

export function IconHighlighter(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m4 21 1-3 9-9 3 3-9 9z" />
      <path d="M14 6l4-4 4 4-4 4z" />
    </Base>
  );
}

export function IconEraser(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m20 13-7 7H7l-4-4 9-9z" />
      <path d="m13 6 5 5" />
    </Base>
  );
}

export function IconUndo(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M3 7h11a5 5 0 0 1 0 10H8" />
      <path d="m7 3-4 4 4 4" />
    </Base>
  );
}

export function IconRedo(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M21 7H10a5 5 0 0 0 0 10h6" />
      <path d="m17 3 4 4-4 4" />
    </Base>
  );
}

export function IconMoreHorizontal(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Base>
  );
}
