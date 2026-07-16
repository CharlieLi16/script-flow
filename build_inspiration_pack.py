#!/usr/bin/env python3
"""Build a traceable 4K visual-reference pack from Wikimedia Commons."""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "MirroS-Inspiration-Pack/1.0 (visual research; Wikimedia Commons)"
THEMES = ("Light", "Material", "Geometry", "Reflection", "Space")
MIN_LONG_EDGE = 3840
MIN_SHORT_EDGE = 2160
TARGET_TOTAL = 200
MIN_TOTAL = 195
MIN_PER_ARTIST = 15
MAX_PER_ARTIST = 25
MIN_CANDIDATES_PER_ARTIST = 22

# Priority order favors work relevant to light, reflection, material, geometry, and space.
# Artists without enough qualifying open-source documentation are skipped automatically.
ARTIST_POOLS = (
    ("James Turrell", ("James Turrell", "Skyspaces")),
    ("Olafur Eliasson", ("Olafur Eliasson",)),
    ("Anish Kapoor", ("Artworks by Anish Kapoor", "Anish Kapoor")),
    ("Yayoi Kusama", ("Artworks by Yayoi Kusama",)),
    ("Dan Flavin", ("Dan Flavin",)),
    ("Daniel Buren", ("Artworks by Daniel Buren", "Daniel Buren")),
    ("Richard Serra", ("Artworks by Richard Serra", "Richard Serra")),
    ("Jeppe Hein", ("Artworks by Jeppe Hein", "Jeppe Hein")),
    ("Alicja Kwade", ("Alicja Kwade",)),
    ("Ai Weiwei", ("Artworks by Ai Weiwei", "Ai Weiwei")),
    ("Jaume Plensa", ("Artworks by Jaume Plensa", "Jaume Plensa")),
    ("Antony Gormley", ("Artworks by Antony Gormley", "Antony Gormley")),
    ("Christo and Jeanne-Claude", ("Christo and Jeanne-Claude",)),
    ("Donald Judd", ("Artworks by Donald Judd", "Donald Judd")),
    ("Carlos Cruz-Diez", ("Carlos Cruz-Diez",)),
    ("Jesús Rafael Soto", ("Jesús Rafael Soto",)),
)

THEME_WORDS = {
    "Light": (
        "light", "neon", "fluorescent", "skyspace", "rainbow", "weather",
        "illumination", "led", "color", "colour", "sun", "glow",
    ),
    "Material": (
        "steel", "metal", "aluminium", "aluminum", "stone", "glass", "wood",
        "fabric", "concrete", "iron", "marble", "bronze", "sculpture",
    ),
    "Geometry": (
        "geometry", "geometric", "column", "ring", "sphere", "cube", "circle",
        "line", "grid", "arc", "spiral", "plateau", "pavilion",
    ),
    "Reflection": (
        "mirror", "reflection", "reflective", "cloud gate", "bean", "lens",
        "narcissus", "polished", "infinity", "glass",
    ),
    "Space": (
        "space", "installation", "room", "museum", "gallery", "pavilion",
        "tunnel", "site-specific", "environment", "interior", "landscape",
    ),
}

EXCLUDE_WORDS = (
    "portrait of", "speaking at", "interview", "signature", "autograph",
    "award ceremony", "press conference", "headshot", "grave of",
)


@dataclass
class Candidate:
    artist: str
    title: str
    source_categories: list[str]
    width: int
    height: int
    bytes: int
    sha1: str
    mime: str
    url: str
    description_url: str
    author: str = ""
    license: str = ""
    license_url: str = ""
    credit: str = ""
    description: str = ""
    score: float = 0.0
    local_file: str = ""
    theme: str = ""
    dhash: str = ""


def api(params: dict[str, Any], retries: int = 6) -> dict[str, Any]:
    query = urllib.parse.urlencode({"format": "json", "formatversion": 2, **params})
    request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return json.load(response)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def clean_html(value: Any) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def slug(value: str, max_length: int = 90) -> str:
    value = re.sub(r"^File:", "", value, flags=re.I)
    stem = Path(value).stem
    stem = re.sub(r"[^\w.-]+", "-", stem, flags=re.UNICODE).strip("-_.")
    return (stem or "image")[:max_length]


def collect_category_files(category: str, max_depth: int = 2) -> dict[str, set[str]]:
    files: dict[str, set[str]] = defaultdict(set)
    seen: set[str] = set()
    queue: list[tuple[str, int]] = [(f"Category:{category}", 0)]
    while queue:
        current, depth = queue.pop(0)
        if current in seen:
            continue
        seen.add(current)
        continuation: dict[str, Any] = {}
        while True:
            data = api({
                "action": "query",
                "list": "categorymembers",
                "cmtitle": current,
                "cmlimit": "500",
                "cmtype": "file|subcat",
                **continuation,
            })
            for member in data.get("query", {}).get("categorymembers", []):
                if member["ns"] == 6:
                    files[member["title"]].add(current.removeprefix("Category:"))
                elif member["ns"] == 14 and depth < max_depth:
                    queue.append((member["title"], depth + 1))
            if "continue" not in data:
                break
            continuation = data["continue"]
    return files


def fetch_candidates(artist: str, categories: tuple[str, ...]) -> list[Candidate]:
    pages: dict[str, dict[str, Any]] = {}
    continuation: dict[str, Any] = {}
    for _ in range(10):
        data = api({
            "action": "query",
            "generator": "search",
            "gsrsearch": f'"{artist}"',
            "gsrnamespace": 6,
            "gsrlimit": 50,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|sha1|extmetadata",
            **continuation,
        })
        for page in data.get("query", {}).get("pages", []):
            pages[page["title"]] = page
        if "continue" not in data:
            break
        continuation = data["continue"]

    candidates: list[Candidate] = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        width, height = info.get("width", 0), info.get("height", 0)
        mime = info.get("mime", "")
        lowered = page.get("title", "").lower()
        if (
            max(width, height) < MIN_LONG_EDGE
            or min(width, height) < MIN_SHORT_EDGE
            or mime not in {"image/jpeg", "image/png", "image/webp"}
            or any(word in lowered for word in EXCLUDE_WORDS)
        ):
            continue
        meta = info.get("extmetadata", {})
        value = lambda key: clean_html(meta.get(key, {}).get("value", ""))
        text = " ".join([page["title"], *categories, value("ImageDescription")]).lower()
        if any(word in text for word in EXCLUDE_WORDS):
            continue
        relevance = sum(2 for words in THEME_WORDS.values() for word in words if word in text)
        resolution = min(max(width, height) / 3840, 3) + min(min(width, height) / 2160, 3)
        candidates.append(Candidate(
            artist=artist,
            title=page["title"],
            source_categories=list(categories),
            width=width,
            height=height,
            bytes=info.get("size", 0),
            sha1=info.get("sha1", ""),
            mime=mime,
            url=info.get("url", ""),
            description_url=info.get("descriptionurl", ""),
            author=value("Artist"),
            license=value("LicenseShortName"),
            license_url=value("LicenseUrl"),
            credit=value("Credit"),
            description=value("ImageDescription"),
            score=relevance + resolution,
        ))
    return sorted(candidates, key=lambda item: (-item.score, -item.width * item.height, item.title))


def balanced_shortlist(candidates: list[Candidate], count: int) -> list[Candidate]:
    groups: dict[str, list[Candidate]] = defaultdict(list)
    seen_sha1: set[str] = set()
    for item in candidates:
        if item.sha1 and item.sha1 in seen_sha1:
            continue
        seen_sha1.add(item.sha1)
        normalized = re.sub(r"\b(19|20)\d{2}\b|\d+", " ", slug(item.title).lower())
        tokens = [
            token for token in re.split(r"[-_.]+", normalized)
            if len(token) > 2 and token not in {"jpg", "jpeg", "png", "webp", "file"}
        ]
        work_family = "-".join(tokens[:5]) or item.title
        groups[work_family].append(item)
    selected: list[Candidate] = []
    ordered_groups = sorted(groups, key=lambda name: (-groups[name][0].score, name))
    while ordered_groups and len(selected) < count:
        next_groups = []
        for name in ordered_groups:
            if groups[name] and len(selected) < count:
                selected.append(groups[name].pop(0))
            if groups[name]:
                next_groups.append(name)
        ordered_groups = next_groups
    return selected


def download_one(item: Candidate, destination: Path) -> tuple[Candidate, Path]:
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[item.mime]
    identity = (item.sha1 or hashlib.sha1(item.url.encode()).hexdigest())[:8]
    filename = f"{slug(item.title)}__{identity}{extension}"
    output = destination / filename
    if output.exists():
        try:
            with Image.open(output) as image:
                image.verify()
            return item, output
        except Exception:
            output.unlink(missing_ok=True)
    download_url = item.url
    parsed = urllib.parse.urlsplit(item.url)
    if (
        parsed.netloc == "upload.wikimedia.org"
        and "/wikipedia/commons/" in parsed.path
        and max(item.width, item.height) > MIN_LONG_EDGE
    ):
        original_name = parsed.path.rsplit("/", 1)[-1]
        target_width = (
            MIN_LONG_EDGE
            if item.width >= item.height
            else round(MIN_LONG_EDGE * item.width / item.height)
        )
        thumb_path = parsed.path.replace(
            "/wikipedia/commons/", "/wikipedia/commons/thumb/", 1
        )
        thumb_path = f"{thumb_path}/{target_width}px-{original_name}"
        download_url = urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, thumb_path, "", "")
        )
    def run_curl(url: str, retries: int, max_time: int) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "curl", "--fail", "--location", "--silent", "--show-error",
                "--retry", str(retries), "--retry-all-errors", "--retry-delay", "2",
                "--connect-timeout", "10", "--max-time", str(max_time),
                "--user-agent", USER_AGENT, "--output", str(output), url,
            ],
            capture_output=True,
            text=True,
            timeout=max_time + 30,
        )

    try:
        result = run_curl(download_url, retries=2, max_time=90)
        if result.returncode != 0 and download_url != item.url:
            output.unlink(missing_ok=True)
            result = run_curl(item.url, retries=10, max_time=180)
    except subprocess.TimeoutExpired as error:
        output.unlink(missing_ok=True)
        raise RuntimeError(f"download timed out: {item.title}") from error
    if result.returncode != 0:
        output.unlink(missing_ok=True)
        detail = (result.stderr.strip().splitlines() or [f"curl exited {result.returncode}"])[-1]
        raise RuntimeError(f"{item.title}: {detail}")
    return item, output


def image_dhash(path: Path) -> int:
    with Image.open(path) as image:
        gray = ImageOps.exif_transpose(image).convert("L").resize((9, 8), Image.Resampling.LANCZOS)
        pixels = list(gray.get_flattened_data())
    value = 0
    for row in range(8):
        for col in range(8):
            value = (value << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return value


def hamming(first: int, second: int) -> int:
    return (first ^ second).bit_count()


def download_and_dedupe(
    candidates: list[Candidate], artist_dir: Path, target: int
) -> list[Candidate]:
    artist_dir.mkdir(parents=True, exist_ok=True)
    provisional = artist_dir / "_incoming"
    provisional.mkdir(exist_ok=True)
    kept: list[Candidate] = []
    hashes: list[int] = []
    candidate_by_identity = {
        (item.sha1 or hashlib.sha1(item.url.encode()).hexdigest())[:8]: item
        for item in candidates
    }

    def keep_download(item: Candidate, path: Path) -> bool:
        try:
            with Image.open(path) as image:
                width, height = image.size
                image.verify()
            if max(width, height) < MIN_LONG_EDGE or min(width, height) < MIN_SHORT_EDGE:
                path.unlink(missing_ok=True)
                return False
            item.width, item.height = width, height
            digest = image_dhash(path)
        except Exception:
            path.unlink(missing_ok=True)
            return False
        if any(hamming(digest, existing) <= 4 for existing in hashes):
            path.unlink(missing_ok=True)
            return False
        index = len(kept) + 1
        if path.parent == provisional:
            final = artist_dir / f"{index:02d}_{path.name}"
            path.replace(final)
        else:
            final = path
        item.local_file = str(final)
        item.dhash = f"{digest:016x}"
        kept.append(item)
        hashes.append(digest)
        return True

    used_identities: set[str] = set()
    for path in sorted(item for item in artist_dir.iterdir() if item.is_file()):
        match = re.search(r"__([0-9a-f]{8})\.(?:jpe?g|png|webp)$", path.name, re.I)
        if not match or match.group(1) not in candidate_by_identity:
            continue
        identity = match.group(1)
        if keep_download(candidate_by_identity[identity], path):
            used_identities.add(identity)
        if len(kept) >= target:
            shutil.rmtree(provisional, ignore_errors=True)
            print(f"  resumed {len(kept)} validated files", flush=True)
            return kept[:target]

    pending = [
        item for item in candidates
        if (item.sha1 or hashlib.sha1(item.url.encode()).hexdigest())[:8] not in used_identities
    ]
    attempted = 0
    for start in range(0, len(pending), 4):
        batch = pending[start:start + 4]
        downloaded: list[tuple[Candidate, Path]] = []
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(download_one, item, provisional) for item in batch]
            for future in as_completed(futures):
                attempted += 1
                try:
                    downloaded.append(future.result())
                except Exception as error:
                    print(f"  download failed: {error}", file=sys.stderr)
        for item, path in sorted(downloaded, key=lambda pair: (-pair[0].score, pair[0].title)):
            keep_download(item, path)
            if len(kept) >= target:
                break
        print(
            f"  download progress: {attempted}/{len(pending)}; kept {len(kept)}/{target}",
            flush=True,
        )
        if len(kept) >= target:
            break
    shutil.rmtree(provisional, ignore_errors=True)
    return kept


def assign_themes(items: list[Candidate]) -> None:
    capacities = {theme: len(items) // len(THEMES) for theme in THEMES}
    overflow = len(items) - sum(capacities.values())
    for theme in THEMES[:overflow]:
        capacities[theme] += 1
    for item in sorted(items, key=lambda candidate: -candidate.score):
        text = " ".join([
            item.title, item.description, *item.source_categories, item.artist
        ]).lower()
        scores = {
            theme: sum(1 for word in THEME_WORDS[theme] if word in text)
            for theme in THEMES
        }
        available = [theme for theme in THEMES if capacities[theme] > 0]
        theme = max(available, key=lambda name: (scores[name], capacities[name], -THEMES.index(name)))
        item.theme = theme
        capacities[theme] -= 1


def create_theme_links(items: list[Candidate], output: Path) -> None:
    root = output / "02_By_Theme"
    for theme in THEMES:
        (root / theme).mkdir(parents=True, exist_ok=True)
    for item in items:
        source = Path(item.local_file)
        destination = root / item.theme / f"{slug(item.artist, 35)}__{source.name}"
        try:
            os.link(source, destination)
        except OSError:
            shutil.copy2(source, destination)


def make_thumbnail(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((900, 700), Image.Resampling.LANCZOS)
        image.save(destination, "JPEG", quality=84, optimize=True)


def draw_contact_page(
    pdf: canvas.Canvas, title: str, items: list[Candidate], thumbs: Path, page_number: int
) -> None:
    width, height = landscape(A4)
    pdf.setFillColor(HexColor("#F4F1EA"))
    pdf.rect(0, 0, width, height, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#151515"))
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(34, height - 34, title)
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(HexColor("#77736B"))
    pdf.drawRightString(width - 34, height - 31, f"MirroS Inspiration Pack  ·  {page_number:02d}")

    columns, rows = 3, 3
    gap, margin_x, top, bottom = 12, 34, 54, 30
    cell_width = (width - margin_x * 2 - gap * (columns - 1)) / columns
    cell_height = (height - top - bottom - gap * (rows - 1)) / rows
    for index, item in enumerate(items):
        row, column = divmod(index, columns)
        x = margin_x + column * (cell_width + gap)
        y = height - top - (row + 1) * cell_height - row * gap
        caption_height = 24
        image_box_height = cell_height - caption_height
        thumb = thumbs / f"{hashlib.sha1(item.local_file.encode()).hexdigest()}.jpg"
        if not thumb.exists():
            make_thumbnail(Path(item.local_file), thumb)
        with Image.open(thumb) as image:
            image_width, image_height = image.size
        scale = min(cell_width / image_width, image_box_height / image_height)
        draw_width, draw_height = image_width * scale, image_height * scale
        image_x = x + (cell_width - draw_width) / 2
        image_y = y + caption_height + (image_box_height - draw_height) / 2
        pdf.drawImage(
            ImageReader(str(thumb)), image_x, image_y, draw_width, draw_height,
            preserveAspectRatio=True, mask="auto",
        )
        pdf.setFillColor(HexColor("#151515"))
        pdf.setFont("Helvetica-Bold", 7.5)
        label = f"{item.artist}  ·  {item.theme}"
        pdf.drawString(x, y + 13, label[:52])
        pdf.setFillColor(HexColor("#77736B"))
        pdf.setFont("Helvetica", 6.5)
        pdf.drawString(x, y + 3, f"{item.width}×{item.height}  ·  {item.license or 'See source'}")


def create_contact_sheet(items: list[Candidate], output: Path) -> Path:
    pdf_path = output / "MirroS_Inspiration_Pack_Contact_Sheet.pdf"
    thumbs = output / "Preview_Thumbnails"
    pdf = canvas.Canvas(str(pdf_path), pagesize=landscape(A4), pageCompression=1)
    width, height = landscape(A4)
    pdf.setTitle("MirroS Inspiration Pack — Contact Sheet")
    pdf.setFillColor(HexColor("#111111"))
    pdf.rect(0, 0, width, height, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#F4F1EA"))
    pdf.setFont("Helvetica-Bold", 34)
    pdf.drawString(46, height - 105, "MirroS")
    pdf.setFont("Helvetica", 23)
    pdf.drawString(46, height - 140, "Inspiration Pack")
    pdf.setFillColor(HexColor("#AAA69D"))
    pdf.setFont("Helvetica", 11)
    pdf.drawString(46, height - 172, f"{len(items)} traceable 4K references")
    pdf.drawString(46, height - 190, "Light / Material / Geometry / Reflection / Space")
    pdf.showPage()

    page_number = 2
    by_artist: dict[str, list[Candidate]] = defaultdict(list)
    for item in items:
        by_artist[item.artist].append(item)
    for artist, artist_items in by_artist.items():
        for start in range(0, len(artist_items), 9):
            suffix = f"  ·  {start + 1}–{min(start + 9, len(artist_items))} / {len(artist_items)}"
            draw_contact_page(pdf, artist + suffix, artist_items[start:start + 9], thumbs, page_number)
            pdf.showPage()
            page_number += 1
    pdf.save()
    return pdf_path


def write_metadata(items: list[Candidate], output: Path) -> None:
    fields = [
        "artist", "theme", "title", "width", "height", "bytes", "mime", "sha1",
        "dhash", "license", "license_url", "author", "credit", "description",
        "description_url", "url", "source_categories", "local_file",
    ]
    with (output / "CREDITS.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in items:
            row = asdict(item)
            row["source_categories"] = " | ".join(item.source_categories)
            row["local_file"] = str(Path(item.local_file).relative_to(output))
            writer.writerow({field: row[field] for field in fields})
    manifest = {
        "title": "MirroS Inspiration Pack",
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "minimum_resolution": {
            "long_edge": MIN_LONG_EDGE,
            "short_edge": MIN_SHORT_EDGE,
        },
        "count": len(items),
        "artists": dict(sorted({
            artist: sum(item.artist == artist for item in items)
            for artist in {item.artist for item in items}
        }.items())),
        "themes": {theme: sum(item.theme == theme for item in items) for theme in THEMES},
        "items": [
            {
                **asdict(item),
                "local_file": str(Path(item.local_file).relative_to(output)),
            }
            for item in items
        ],
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    readme = f"""# MirroS Inspiration Pack

{len(items)} 张可追溯的高分辨率视觉参考图，按艺术家与主题双重整理。

## 目录

- `01_By_Artist/`：按艺术家分类的原始高清文件
- `02_By_Theme/`：按 Light / Material / Geometry / Reflection / Space 分类
- `Preview_Thumbnails/`：PDF 使用的轻量预览图
- `CREDITS.csv`：作者、许可、原图地址、来源页及分辨率
- `manifest.json`：机器可读索引及校验信息
- `MirroS_Inspiration_Pack_Contact_Sheet.pdf`：快速浏览联系表

## 质量与使用说明

- 分辨率硬门槛：长边 ≥ {MIN_LONG_EDGE}px、短边 ≥ {MIN_SHORT_EDGE}px。
- 已按 Commons SHA-1 和感知哈希自动去重。
- `02_By_Theme` 优先使用硬链接，避免重复占用磁盘；删除其中副本不会删除艺术家目录原图。
- 图像来自 Wikimedia Commons，但每张许可不同。品牌公开发布、广告、再分发或商业印刷前，请逐项核对 `CREDITS.csv` 中的许可、署名和作品所在地全景自由规则。
- 本资料库定位为内部视觉研究与灵感索引，不代表对艺术家作品风格的复制授权。
"""
    (output / "README.md").write_text(readme, encoding="utf-8")


def choose_artist_targets(discovered: list[tuple[str, list[Candidate]]]) -> list[tuple[str, list[Candidate], int]]:
    eligible = [(artist, items) for artist, items in discovered if len(items) >= MIN_PER_ARTIST]
    selected: list[tuple[str, list[Candidate], int]] = []
    remaining = TARGET_TOTAL
    for artist, items in eligible:
        artists_left = max(1, min(len(eligible), 10) - len(selected))
        target = min(MAX_PER_ARTIST, len(items), max(MIN_PER_ARTIST, round(remaining / artists_left)))
        selected.append((artist, items, target))
        remaining -= target
        if remaining <= 0 or len(selected) == 10:
            break
    if remaining > 0:
        for index, (artist, items, target) in enumerate(selected):
            extra = min(MAX_PER_ARTIST - target, len(items) - target, remaining)
            selected[index] = (artist, items, target + extra)
            remaining -= extra
            if remaining == 0:
                break
    if remaining > 0:
        raise RuntimeError(f"Not enough qualifying images; short by {remaining}.")
    return selected


def build(output: Path) -> None:
    if (output / "manifest.json").exists():
        raise FileExistsError(f"Completed output already exists: {output}")
    output.mkdir(parents=True, exist_ok=True)
    artist_root = output / "01_By_Artist"
    artist_root.mkdir(exist_ok=True)
    cache_file = output / "_discovery_cache.json"
    cache: dict[str, list[dict[str, Any]]] = {}
    if cache_file.exists():
        cache = json.loads(cache_file.read_text(encoding="utf-8"))

    discovered: list[tuple[str, list[Candidate]]] = []
    for artist, categories in ARTIST_POOLS:
        print(f"Discovering {artist}...", flush=True)
        if artist in cache:
            candidates = [Candidate(**item) for item in cache[artist]]
            print("  using cached metadata", flush=True)
        else:
            try:
                candidates = fetch_candidates(artist, categories)
            except Exception as error:
                print(f"  discovery failed, skipping: {error}", file=sys.stderr, flush=True)
                continue
            cache[artist] = [asdict(item) for item in candidates]
            cache_file.write_text(
                json.dumps(cache, ensure_ascii=False), encoding="utf-8"
            )
        print(f"  {len(candidates)} strict-4K candidates", flush=True)
        if len(candidates) >= MIN_CANDIDATES_PER_ARTIST:
            discovered.append((artist, candidates))
        available = sum(min(MAX_PER_ARTIST, len(items)) for _, items in discovered)
        if len(discovered) >= 9 and available >= TARGET_TOTAL:
            break

    targets = choose_artist_targets(discovered)
    all_items: list[Candidate] = []
    for artist, candidates, target in targets:
        print(f"Downloading {artist}: target {target}...", flush=True)
        shortlist = balanced_shortlist(candidates, min(len(candidates), target + 30))
        kept = download_and_dedupe(shortlist, artist_root / slug(artist, 50), target)
        if len(kept) < MIN_PER_ARTIST:
            raise RuntimeError(f"{artist}: only {len(kept)} images remained after validation.")
        all_items.extend(kept)
        print(f"  kept {len(kept)}", flush=True)

    if len(all_items) < MIN_TOTAL:
        raise RuntimeError(
            f"Pack contains {len(all_items)} images, expected at least {MIN_TOTAL}."
        )
    all_items = all_items[:TARGET_TOTAL]
    assign_themes(all_items)
    create_theme_links(all_items, output)
    write_metadata(all_items, output)
    pdf = create_contact_sheet(all_items, output)
    cache_file.unlink(missing_ok=True)
    print(f"Done: {len(all_items)} images and {pdf}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("MirroS_Inspiration_Pack"),
        help="New output directory (must not already exist)",
    )
    args = parser.parse_args()
    build(args.output.resolve())


if __name__ == "__main__":
    main()
