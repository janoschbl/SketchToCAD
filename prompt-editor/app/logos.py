"""Logos aus dem Netz holen (für klebe_logo).

Reihenfolge:
  1. Wikimedia Commons: Dateisuche „<marke> logo“, SVGs kommen als PNG-Vorschau (transparenter Hintergrund).
  2. Website der Marke (domain): größtes apple-touch-icon / icon aus dem HTML-Kopf.
  3. Favicon-Dienst von Google (bis 256 px) als letzter Ausweg.
Ergebnisse werden in DATA/logos/ zwischengespeichert. Es werden nur öffentliche https-Adressen abgerufen.
"""
from __future__ import annotations

import hashlib
import ipaddress
import os
import re
import socket
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse

import numpy as np
from PIL import Image, UnidentifiedImageError

UA = "SketchToCAD-Logo/0.1 (Prompt-Editor)"
MAX_BYTES = 6 * 1024 * 1024
TIMEOUT_S = 8.0
MIN_SIDE = 48
COMMONS_API = "https://commons.wikimedia.org/w/api.php"


class LogoError(Exception):
    pass


def cache_dir() -> Path:
    root = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
    d = root / "logos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _public_https(url: str):
    """Nur https auf öffentliche Hosts (kein localhost, kein LAN)."""
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname:
        raise LogoError(f"Nur https-Adressen erlaubt: {url}")
    try:
        infos = socket.getaddrinfo(u.hostname, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise LogoError(f"Host nicht gefunden: {u.hostname}") from exc
    for info in infos:
        if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
            raise LogoError(f"Host ist nicht öffentlich: {u.hostname}")


def _get(url: str, accept: str = "*/*") -> tuple[bytes, str, str]:
    """GET mit Größenlimit; Weiterleitungen werden einzeln geprüft. → (Daten, Content-Type, End-URL)."""
    import httpx

    for _ in range(5):
        _public_https(url)
        with httpx.Client(timeout=TIMEOUT_S, headers={"User-Agent": UA, "Accept": accept}) as client:
            with client.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code != 200:
                    raise LogoError(f"HTTP {r.status_code} für {url}")
                data = bytearray()
                for chunk in r.iter_bytes():
                    data += chunk
                    if len(data) > MAX_BYTES:
                        raise LogoError("Datei zu groß.")
                return bytes(data), r.headers.get("content-type", ""), url
    raise LogoError("Zu viele Weiterleitungen.")


def _open_image(raw: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(raw), formats=("PNG", "JPEG", "WEBP", "GIF", "ICO")) as img:
            if img.width * img.height > 24_000_000:
                raise LogoError("Logo-Bild zu groß.")
            if getattr(img, "n_frames", 1) > 1:
                img.seek(0)
            return img.convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise LogoError("Kein lesbares Bild (PNG, JPEG, WebP, GIF, ICO).") from exc


def strip_background(img: Image.Image, tol: float = 26.0) -> Image.Image:
    """Ohne Transparenz: einheitlichen Rand (meist Weiß) freistellen und auf den Inhalt zuschneiden."""
    a = np.asarray(img.convert("RGBA")).astype(float)
    if a[..., 3].min() < 250:
        rgba = img
    else:
        h, w = a.shape[:2]
        edge = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
        bg = np.median(edge, axis=0)
        if np.mean(np.linalg.norm(edge - bg, axis=1) < tol) < 0.85:
            return img  # Rand nicht einheitlich: Bild unverändert lassen (z. B. App-Icon mit Fläche)
        d = np.linalg.norm(a[..., :3] - bg, axis=-1)
        alpha = np.clip((d - tol * 0.5) / tol, 0, 1) * 255
        a[..., 3] = np.minimum(a[..., 3], alpha)
        rgba = Image.fromarray(a.round().astype(np.uint8), "RGBA")
    box = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return rgba.crop(box) if box else rgba


# ---------------------------------------------------------------- Quellen
def _words(s: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9äöüß]+", s.lower()) if w not in ("logo", "the", "der", "die", "das")]


def commons_candidates(marke: str) -> list[dict]:
    import httpx

    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 15,
              "gsrsearch": f"{marke} logo", "prop": "imageinfo", "iiprop": "url|mime|size", "iiurlwidth": 600}
    try:
        r = httpx.get(COMMONS_API, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT_S)
        pages = (r.json().get("query") or {}).get("pages") or {}
    except (httpx.HTTPError, ValueError):
        return []
    words = _words(marke)
    out = []
    for p in pages.values():
        title = p.get("title", "")
        info = (p.get("imageinfo") or [{}])[0]
        t = title.lower()
        score = 0
        score += 4 if "logo" in t else 0
        score += 4 if words and all(w in t.replace("_", " ") for w in words) else 0
        score += {"image/svg+xml": 3, "image/png": 1, "image/webp": 0}.get(info.get("mime"), -3)
        score -= 3 if re.search(r"placeholder|text logo|wordmark only|racing|team|\d{4}", t) and \
            not any(re.search(r"racing|team|\d{4}", w) for w in words) else 0
        score -= p.get("index", 0) * 0.1
        url = info.get("thumburl") or info.get("url")
        if url:
            out.append({"titel": title, "url": url, "score": score,
                        "seite": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{title}"})
    return sorted(out, key=lambda c: -c["score"])


class _IconParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons: list[tuple[int, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        rel = a.get("rel", "").lower()
        href = a.get("href")
        if not href or "icon" not in rel or href.lower().endswith(".svg") or "mask-icon" in rel:
            return
        sizes = [int(n) for n in re.findall(r"(\d+)x\d+", a.get("sizes", ""))]
        size = max(sizes) if sizes else (180 if "apple" in rel else 32)
        self.icons.append((size, href))


def site_icon_urls(domain: str) -> list[str]:
    domain = re.sub(r"^https?://", "", domain.strip().lower()).split("/")[0]
    if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", domain):
        return []
    urls = []
    try:
        html, _, final = _get(f"https://{domain}", "text/html")
        parser = _IconParser()
        parser.feed(html[:500_000].decode("utf-8", "ignore"))
        urls += [urljoin(final, href) for _, href in sorted(parser.icons, key=lambda x: -x[0])]
    except LogoError:
        pass
    urls.append(f"https://www.google.com/s2/favicons?domain={domain}&sz=256")
    return urls


def fetch(marke: str | None, domain: str | None = None, symbol_first: bool = False) -> tuple[Image.Image, str]:
    """→ (RGBA-Bild, Quelle-URL). Wirft LogoError, wenn nichts Brauchbares gefunden wird."""
    marke = (marke or "").strip()[:80]
    domain = (domain or "").strip()[:120] or None
    if not marke and not domain:
        raise LogoError("Für ein Logo aus dem Netz brauche ich einen Markennamen oder eine Domain.")
    key = hashlib.sha1(f"{marke.lower()}|{(domain or '').lower()}|{int(symbol_first)}".encode()).hexdigest()[:16]
    cached = cache_dir() / f"{key}.png"
    meta = cached.with_suffix(".txt")
    if cached.exists() and meta.exists():
        return Image.open(cached).convert("RGBA"), meta.read_text().strip()

    candidates = [c["url"] for c in commons_candidates(marke) if c["score"] >= 7][:3] if marke else []
    if domain:  # Webseiten-Icons sind meist nur das Bildzeichen – bei „nur Symbol“ zuerst
        candidates = site_icon_urls(domain) + candidates if symbol_first else candidates + site_icon_urls(domain)
    fehler = []
    for url in candidates:
        try:
            raw, _, final = _get(url, "image/*")
            img = strip_background(_open_image(raw))
            if min(img.size) < MIN_SIDE and "favicons" not in url:
                fehler.append(f"{url}: zu klein")
                continue
            img.save(cached)
            meta.write_text(final)
            return img, final
        except LogoError as exc:
            fehler.append(str(exc))
    hint = "" if domain else " Tipp: Domain der Marke angeben (z. B. base44.com)."
    raise LogoError(f"Kein Logo für „{marke or domain}“ gefunden.{hint}" + (f" ({'; '.join(fehler[:2])})" if fehler else ""))


def symbol_only(img: Image.Image, min_gap: float = 0.03) -> Image.Image:
    """Nur das Bildzeichen eines Logos (ohne Schriftzug): trennt den Inhalt an Lücken in Spalten bzw. Zeilen
    und nimmt den Block, der am ehesten quadratisch ist. Bleibt das Bild unverändert, wenn es nur einen Block gibt."""
    rgba = img.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A")) > 16
    if not alpha.any():
        return img
    ys0, xs0 = np.nonzero(alpha)
    ratio = (xs0.max() - xs0.min() + 1) / (ys0.max() - ys0.min() + 1)
    if 0.62 < ratio < 1.6:
        return img  # annähernd quadratisch: schon nur ein Bildzeichen (z. B. Icon mit Lücke)
    best = None
    for axis in ((0,) if ratio >= 1.6 else (1,)):  # 0: Spalten (Zeichen links/rechts vom Text), 1: Zeilen (Zeichen über dem Text)
        occupied = alpha.any(axis=axis)
        n = len(occupied)
        runs, start = [], None
        for i, v in enumerate(occupied):
            if v and start is None:
                start = i
            if (not v or i == n - 1) and start is not None:
                runs.append((start, i if not v else i + 1))
                start = None
        merged = []
        for r in runs:  # kleine Lücken (Buchstabenabstand) überbrücken
            if merged and r[0] - merged[-1][1] < max(2, min_gap * n):
                merged[-1] = (merged[-1][0], r[1])
            else:
                merged.append(r)
        if len(merged) < 2:
            continue
        for lo, hi in merged:
            sub = alpha[:, lo:hi] if axis == 0 else alpha[lo:hi, :]
            ys, xs = np.nonzero(sub)
            if not len(xs):
                continue
            bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
            aspect = bw / bh
            score = abs(np.log(aspect)) + (0 if sub.sum() > 0.03 * alpha.sum() else 5)
            if best is None or score < best[0]:
                box = (lo + xs.min(), ys.min(), lo + xs.max() + 1, ys.max() + 1) if axis == 0 else \
                      (xs.min(), lo + ys.min(), xs.max() + 1, lo + ys.max() + 1)
                best = (score, box)
    if best is None or best[0] > 0.9:
        return img
    return rgba.crop(best[1])
