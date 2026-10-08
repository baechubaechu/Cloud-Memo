"""Resolve absolute folder paths and legacy title links without guessing a target."""
from dataclasses import dataclass
from urllib.parse import quote, unquote
from uuid import UUID


@dataclass(frozen=True)
class NoteRef:
    id: UUID
    title: str
    folder_id: UUID | None


@dataclass(frozen=True)
class FolderRef:
    id: UUID
    name: str
    parent_id: UUID | None


def encode_part(value: str) -> str:
    return "".join(quote(char, safe="") if char in "/%[]|\n\r" else char for char in value.strip())


def folder_path(folder_id: UUID | None, folders: list[FolderRef]) -> str | None:
    by_id = {folder.id: folder for folder in folders}
    parts = []
    seen = set()
    while folder_id is not None:
        if folder_id in seen or folder_id not in by_id:
            return None
        seen.add(folder_id)
        folder = by_id[folder_id]
        parts.insert(0, encode_part(folder.name))
        folder_id = folder.parent_id
    return "/" + "/".join(parts) if parts else ""


def path_key(path: str) -> tuple[str, ...]:
    def decode(part):
        try:
            return unquote(part, errors="strict").strip().lower()
        except UnicodeError:
            return part.strip().lower()
    return tuple(decode(part) for part in path.removeprefix("/").split("/"))


class LinkIndex:
    def __init__(self, notes: list[NoteRef], folders: list[FolderRef]):
        self.titles = {}
        self.paths = {}
        for note in notes:
            parent = folder_path(note.folder_id, folders)
            if parent is not None:
                self.titles.setdefault(note.title.strip().lower(), []).append(note)
                key = path_key(f"{parent}/{encode_part(note.title)}")
                self.paths.setdefault(key, []).append(note)

    def resolve(self, target: str, source_folder: UUID | None) -> list[NoteRef]:
        target = target.strip()
        if "/" in target:
            return self.paths.get(path_key(target), [])
        matches = self.titles.get(target.lower(), [])
        local = [note for note in matches if note.folder_id == source_folder]
        return local or matches
