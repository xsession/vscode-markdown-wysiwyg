# Writing these docs

This site is built with [MkDocs](https://www.mkdocs.org/) and the
[Material](https://squidfunk.github.io/mkdocs-material/) theme. The
configuration is `mkdocs.yml` in the repository root; pages are in `docs/`.

## Preview and build

```sh
python3 -m venv .venv
.venv/bin/pip install mkdocs-material
.venv/bin/mkdocs serve      # live preview at http://127.0.0.1:8000
.venv/bin/mkdocs build      # static site in site/
```

`strict: true` is set, so a broken link or a missing image fails the build.

## Structure

The documentation follows four kinds of page; keep each page to one kind.

| Section | Kind | Rule of thumb |
| --- | --- | --- |
| `getting-started/`, `tutorials/` | tutorial | a complete task, in order, with a visible result |
| `theory/` | explanation | how and why it works; diagrams, algorithms, limits |
| `reference/` | reference | complete and checked against `package.json` and source |
| `development/` | how-to | building, testing and maintaining |

`docs/research/listening-large-documents.md` is also opened by the
extension's **Listen to the Long-Document Reading Guide** command; keep its
path.

## Diagrams

Use Mermaid fences; Material renders them in the page's colour scheme.

````markdown
```mermaid
flowchart LR
    A --> B
```
````

## Screenshots

Screenshots live in `docs/assets/images/` in pairs, `NAME-light.png` and
`NAME-dark.png`. The site's stylesheet shows the one matching the reader's
colour scheme, so put both in the same figure:

```markdown
<figure markdown>
  ![Alt text](../assets/images/NAME-light.png){ .screenshot }
  ![Alt text](../assets/images/NAME-dark.png){ .screenshot }
  <figcaption>Caption.</figcaption>
</figure>
```

They are rendered from the real webview code with
`scripts/docs/screenshots.py`, which loads each webview's HTML, CSS and
script in headless Chromium with VS Code's Light Modern and Dark Modern theme
variables and a stand-in for the VS Code API:

```sh
npm run test-compile
npm run build:editor
.venv/bin/pip install playwright
.venv/bin/python -m playwright install chromium-headless-shell
.venv/bin/python scripts/docs/screenshots.py
```

The latency chart `voice-latency-{light,dark}.svg` is generated from
`docs/validation/native-voices-0.10.json` by `scripts/docs/voice-chart.js`.
