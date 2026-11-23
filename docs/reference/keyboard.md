# Keyboard shortcuts

On macOS, ++cmd++ replaces ++ctrl++ for the editor toggle and Read aloud.

## Anywhere in VS Code

| Keys | Action | Active when |
| --- | --- | --- |
| ++ctrl+shift+e++ | toggle WYSIWYG / plain text | a Markdown file is focused |
| ++ctrl+alt+shift+r++ | read the document aloud | a Markdown file is focused |
| ++ctrl+alt+shift+p++ | play / continue | a reader is open |
| ++ctrl+alt+space++ | pause / resume | a reader is open |
| ++ctrl+alt+shift+s++ | stop | a reader is open |
| ++ctrl+alt+left++ / ++ctrl+alt+right++ | previous / next passage | a reader is open |
| ++ctrl+alt+shift+up++ / ++ctrl+alt+shift+down++ | previous / next heading | a reader is open |
| ++ctrl+alt+shift+b++ | bookmark | a reader is open |
| ++ctrl+alt+shift+l++ | speak the current location | a reader is open |
| ++ctrl+alt+shift+backspace++ | return from jump | a reader is open |

## Inside the reader

| Keys | Action |
| --- | --- |
| ++tab++ / ++shift+tab++ | move between controls |
| ++alt+shift+p++ | play / pause |
| ++alt+shift+left++ / ++alt+shift+right++ | previous / next sentence |
| ++alt+shift+up++ / ++alt+shift+down++ | previous / next heading |
| ++alt+shift+r++ | repeat the current sentence |
| ++alt+shift+b++ | bookmark and confirm aloud |
| ++alt+shift+l++ | speak the current location |

Media keys (play/pause, next, previous) work where the desktop passes them to
VS Code. The shortcuts use modifiers on purpose, so that unmodified keys stay
available to screen readers.

## Inside the WYSIWYG editor

| Keys | Action |
| --- | --- |
| ++ctrl+1++ … ++ctrl+6++ | heading level 1–6 |
| ++ctrl+b++, ++ctrl+i++, ++ctrl+u++ | bold, italic, underline |
| ++ctrl+k++ | link |
| ++tab++ / ++shift+tab++ | indent / outdent list items |
| ++ctrl+shift+v++ | paste as plain text |

## Inside the codebase map

| Keys | Action |
| --- | --- |
| arrow keys | pan (map focused) |
| ++plus++ / ++minus++ | zoom |
| ++enter++ in **Go to file…** | select the first result |
