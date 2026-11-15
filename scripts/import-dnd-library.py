"""Copy selected PDFs and write searchable, page-numbered Markdown locally."""

import argparse
import json
import logging
import re
import shutil
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "docs" / "dnd"
PAGES_PER_FILE = 12


def clean_text(value):
    value = value.replace("\u00ad", "").replace("\u00a0", " ")
    value = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", value.replace("\r", "\n"))
    return "\n".join(line.rstrip() for line in value.splitlines()).strip()


def import_source(source, metadata, output):
    folder = output / metadata["id"]
    folder.mkdir(parents=True, exist_ok=True)
    original = folder / "source.pdf"
    shutil.copyfile(source, original)
    reader = PdfReader(original)
    review = []
    chunks = []
    sections = []

    for number, page in enumerate(reader.pages, start=1):
        try:
            content = clean_text(page.extract_text() or "")
        except Exception as error:
            print(f"{metadata['id']} page {number}: {type(error).__name__}")
            content = ""
        if len(content) < 40 or "\ufffd" in content:
            review.append(number)
        if len(content) < 40:
            content = f"Мало извлекаемого текста. Проверьте [оригинал](source.pdf#page={number}).\n\n{content}"
        sections.append(f"## Страница PDF {number}\n\n{content}\n")
        if number % PAGES_PER_FILE == 0 or number == len(reader.pages):
            first = number - len(sections) + 1
            name = f"pages-{first:04}-{number:04}.md"
            heading = f"# {metadata['title']} · PDF {first}–{number}\n\n"
            (folder / name).write_text(heading + "\n".join(sections), encoding="utf-8")
            chunks.append(f"- [{first}–{number}]({name})")
            sections.clear()

    title = metadata["title"]
    filename = metadata["filename"]
    notes = ", ".join(str(page) for page in review) or "нет по автоматической проверке"
    index = [
        f"# {title}",
        "",
        f"Исходный файл: `{filename}`. [Локальный оригинал](source.pdf).",
        f"Страниц PDF: {len(reader.pages)}. Проверьте по оригиналу иллюстрации, карты и таблицы.",
        f"Страницы с коротким текстом или ошибками извлечения: {notes}.",
        "",
        *chunks,
        "",
    ]
    (folder / "README.md").write_text("\n".join(index), encoding="utf-8")
    return f"- [{title}]({metadata['id']}/README.md) · {len(reader.pages)} стр. · проверить {len(review)} стр."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_folder", type=Path)
    args = parser.parse_args()
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    sources = json.loads((REFERENCE / "sources.json").read_text(encoding="utf-8"))
    missing = [item["filename"] for item in sources if not (args.source_folder / item["filename"]).is_file()]
    if missing:
        parser.error("Missing source PDFs: " + ", ".join(missing))
    output = REFERENCE / "library.local"
    output.mkdir(parents=True, exist_ok=True)
    entries = []
    for item in sources:
        entry = import_source(args.source_folder / item["filename"], item, output)
        entries.append(entry)
        print(entry, flush=True)
    index = "# Локальная библиотека D&D\n\n" + "\n".join(entries) + "\n"
    (output / "README.md").write_text(index, encoding="utf-8")


if __name__ == "__main__":
    main()
