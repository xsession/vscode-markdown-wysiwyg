"""Render the documentation screenshots in docs/assets/images/.

Builds stand-alone webview pages with scripts/docs/webview-pages.js, opens each
one in headless Chromium in the light and dark theme, puts it into a
representative state and saves NAME-light.png and NAME-dark.png.

Requirements: `npm run test-compile`, `npm run build:editor` (for the editor
screenshot), and Playwright for Python with Chromium:

    pip install playwright
    python -m playwright install chromium-headless-shell
    python scripts/docs/screenshots.py
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
IMAGES = ROOT / "docs" / "assets" / "images"
VIEWPORT = {"width": 1280, "height": 760}
TALL = {"reader": {"width": 1280, "height": 1180}}


def codebase_map(page, name):
    page.wait_for_timeout(1200)
    if name == "codebase-map":
        page.fill("#q", "store")
        page.keyboard.press("Enter")
    elif name == "codebase-map-route":
        page.click('button[role="tab"][data-m="route"]')
        for query in ("main", "client"):
            page.fill("#q", query)
            page.keyboard.press("Enter")
            page.wait_for_timeout(300)
    elif name == "codebase-map-runtime":
        page.click('button[role="tab"][data-m="run"]')
        page.click('[data-act="rtdemo"]')
        page.wait_for_timeout(2500)
    page.wait_for_timeout(1500)
    page.evaluate("document.activeElement && document.activeElement.blur()")


def reader(page, _name):
    page.wait_for_timeout(300)
    headings = [
        {"title": "Status LED driver", "level": 1, "index": 0},
        {"title": "Signals", "level": 2, "index": 4},
        {"title": "Blink patterns", "level": 2, "index": 7},
    ]
    passages = [
        "Status LED driver.",
        "The status LED shows the controller state at a glance.",
        "It is driven by a single GPIO pin and blinks with a pattern per state, so that a field engineer can read it without a debugger.",
        "Signals.",
        "Signal: LED. Pin: 13. Direction: out. Notes: active high.",
        "Signal: Button. Pin: 2. Direction: in. Notes: internal pull-up.",
        "Blink patterns.",
        "Idle: one short blink every two seconds.",
        "Capture: steady on.",
        "Fault: three fast blinks, then a pause.",
    ]
    message = {
        "type": "document",
        "title": "Status LED driver",
        "index": 2,
        "total": 48,
        "path": ["Status LED driver"],
        "passages": [{"index": i, "text": t} for i, t in enumerate(passages)],
        "headings": headings,
        "bookmarks": [{"index": 4, "label": "Signals: LED pin"}],
        "structures": [{"line": 4, "kind": "Table", "label": "Signals"}],
        "filters": {"skipCode": True, "skipUrls": True, "skipHeaders": True, "skipFooters": True},
        "rate": 1.25,
        "mode": "continuous",
    }
    voices = {
        "type": "voices",
        "selected": "en_US-ljspeech-medium",
        "voices": [
            {"key": k, "label": label, "installed": True}
            for k, label in [
                ("en_US-ljspeech-medium", "English (US) · LJSpeech"),
                ("en_US-john-medium", "English (US) · John"),
                ("en_US-kristin-medium", "English (US) · Kristin"),
                ("hu_HU-anna-medium", "Magyar · Anna"),
                ("hu_HU-berta-medium", "Magyar · Berta"),
                ("hu_HU-imre-medium", "Magyar · Imre"),
            ]
        ],
    }
    for data in (voices, message, {"type": "status", "text": "Reading · Status LED driver"}):
        page.evaluate("d => window.postMessage(d, '*')", data)
        page.wait_for_timeout(100)
    page.wait_for_timeout(500)


def mindmap(page, _name):
    page.wait_for_timeout(1500)
    page.click('[aria-label="Focus tutorials"]')
    page.wait_for_timeout(500)
    page.select_option("#depth", "2")
    page.wait_for_timeout(500)
    page.click("text=Fit")
    page.wait_for_timeout(800)


def editor(page, _name):
    page.wait_for_selector(".ck-editor__editable", timeout=20000)
    page.wait_for_timeout(1500)
    page.click(".ck-editor__editable h2 >> nth=0")
    page.wait_for_timeout(300)


SHOTS = [
    ("codebase-map", "codebase-map", codebase_map),
    ("codebase-map-route", "codebase-map", codebase_map),
    ("codebase-map-runtime", "codebase-map", codebase_map),
    ("reader", "reader", reader),
    ("mindmap", "mindmap", mindmap),
    ("editor", "editor", editor),
]


def main():
    only = set(sys.argv[1:])
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["node", str(ROOT / "scripts/docs/webview-pages.js"), tmp], check=True)
        pages = Path(tmp)
        IMAGES.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for name, page_name, prepare in SHOTS:
                if only and name not in only:
                    continue
                for mode in ("light", "dark"):
                    source = pages / f"{page_name}-{mode}.html"
                    if not source.exists():
                        print(f"skip {name}-{mode}: {source.name} was not built")
                        continue
                    page = browser.new_page(viewport=TALL.get(name, VIEWPORT), color_scheme=mode, device_scale_factor=1)
                    errors = []
                    page.on("pageerror", lambda e, errors=errors: errors.append(str(e)))
                    page.goto(source.as_uri())
                    prepare(page, name)
                    target = IMAGES / f"{name}-{mode}.png"
                    page.screenshot(path=str(target))
                    page.close()
                    print(f"wrote {target.relative_to(ROOT)}" + (f"  (page errors: {errors})" if errors else ""))
            browser.close()


if __name__ == "__main__":
    main()
