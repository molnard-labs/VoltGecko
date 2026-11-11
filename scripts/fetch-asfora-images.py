#!/usr/bin/env python3
"""Fetch exact Asfora product photos from Schneider Electric's media service.

Requires Pillow. Pass a UTF-8 text file with one manufacturer reference per
line, a JSON array of references or objects with a ``sku`` field, or the
catalogue JSON object with a ``products`` array.
Existing valid images are kept. Missing references are reported individually.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, UnidentifiedImageError


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "src" / "products" / "asfora-images"
REFERENCE = re.compile(r"^EPH[A-Z0-9]+$")


def references_from(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        values = json.loads(text)
        if isinstance(values, dict):
            values = values.get("products")
        if not isinstance(values, list):
            raise ValueError("Expected a JSON array or a products array")
        raw = [item.get("sku") if isinstance(item, dict) else item for item in values]
    else:
        raw = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    if any(not isinstance(value, str) or not REFERENCE.fullmatch(value) for value in raw):
        raise ValueError("Invalid reference in input; expected uppercase Asfora EPH references")
    return list(dict.fromkeys(raw))


def fetch_image(sku: str) -> tuple[str, str]:
    target = OUTPUT / f"{sku}.webp"
    if target.exists():
        try:
            with Image.open(target) as image:
                image.verify()
            return sku, "cached"
        except (OSError, UnidentifiedImageError):
            pass
    query = urllib.parse.urlencode({
        "p_Doc_Ref": f"{sku}_IOP-Front",
        "p_File_Type": "rendition_1500_jpg",
    })
    headers = {"User-Agent": "VoltGecko catalogue image fetcher/1.0"}
    url = f"https://download.se.com/files?{query}"
    try:
        try:
            response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            # Some official products have a different media-reference name.
            # The official shop search redirects exact matches to the product,
            # whose analytics JSON contains the exact SKU and product image.
            url = ""
            for locale in ("bg", "gr"):
                search = f"https://eshop.se.com/{locale}/catalogsearch/result/?" + urllib.parse.urlencode({"q": sku})
                with urllib.request.urlopen(urllib.request.Request(search, headers=headers), timeout=30) as page:
                    html = page.read(10_000_000).decode("utf-8", errors="replace")
                match = re.search(r"var new_data = (\{.*?\});", html)
                if not match:
                    continue
                product = json.loads(match.group(1))
                candidate = product.get("image_url", "")
                host = urllib.parse.urlparse(candidate).hostname or ""
                if (product.get("sku") == sku and (host == "se.com" or host.endswith(".se.com"))
                        and "placeholder" not in candidate.lower() and "no_selection" not in candidate.lower()):
                    url = candidate
                    break
            if not url:
                raise ValueError("no exact product image in official shops")
            response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30)
        with response:
            content_type = response.headers.get_content_type()
            if not content_type.startswith("image/"):
                raise ValueError(f"unexpected content type {content_type}")
            data = response.read(10_000_001)
        if len(data) > 10_000_000:
            raise ValueError("image larger than 10 MB")
        with Image.open(BytesIO(data)) as image:
            image.load()
            image.thumbnail((500, 500), Image.Resampling.LANCZOS)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            image.save(target, format="WEBP", quality=82, method=6)
        return sku, "downloaded"
    except (urllib.error.URLError, OSError, ValueError, UnidentifiedImageError) as error:
        return sku, str(error)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="text or JSON file containing references")
    parser.add_argument("--workers", type=int, default=3, choices=range(1, 5))
    args = parser.parse_args()
    refs = references_from(args.input)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        results = list(executor.map(fetch_image, refs))
    missing = [(sku, status) for sku, status in results if status not in ("cached", "downloaded")]
    for sku, status in missing:
        print(f"MISSING {sku}: {status}")
    print(f"{len(results) - len(missing)}/{len(results)} available; {len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
