# Reading large technical documents by listening

Research and implementation review, 26 October 2026.

## What the evidence supports

Effective auditory reading combines navigation, orientation, repetition and an
appropriate rate. A single long recording gives little control over those
activities. Blind readers differ in experience, preferences, residual vision,
Braille use and task demands; there is no universal blind reading speed or
single best method.

The extension should preserve the author's hierarchy and let a listener move
through it without losing their place. It should help a user understand and
remember useful material, rather than count words played.

| Primary source | Finding relevant to this project | Design decision |
| --- | --- | --- |
| [NVDA User Guide](https://download.nvaccess.org/documentation/userGuide.html) | Browse mode supports heading/paragraph navigation, filtered element lists, text search and reading continuously from a chosen point. Skim-reading commands can change position while continuous speech continues. | Sentence and heading commands, filtered search, continuous playback and explicit location feedback. |
| [DAISY Reading Apps User Requirements](https://daisy.github.io/reading-apps-ux-reqs/requirements/published/FINAL-20251031/) | The requirements identify a table of contents, saved location, navigation history, current-position reporting, configurable pace and skippable content as important reading-app capabilities. | Outline, local resume, return-from-jump history, bookmarks, playback rate and a code-skipping announcement. These features borrow selected requirements; this extension is not a DAISY-conformant reading system. |
| [DAISY user stories](https://daisy.org/activities/standards/reading-apps-user-requirements/user-stories/) | Reader requirements arise from varied real tasks and preferences, rather than one generic disability scenario. | Keep continuous, outline and paragraph-recall modes optional. Do not force a study interruption into every listening session. |
| [W3C page structure tutorial](https://www.w3.org/WAI/tutorials/page-structure/) | Semantic structure helps users find relevant regions and maintain orientation, including people using screen readers and people with cognitive or learning disabilities. | Preserve nested heading paths and use native labelled controls and regions in the reader interface. |
| [W3C keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | Keyboard behavior, focus visibility and conventional interaction must be implemented; ARIA attributes alone do not supply them. | Standard Tab order, visible focus, native selects/buttons and modifier-based shortcuts. Avoid stealing unmodified screen-reader browse keys. |
| [Dietrich, Hertrich & Ackermann, 2013](https://doi.org/10.3389/fnhum.2013.00701) | A small six-person training study found large gains in ultra-fast sentence perception in four participants after roughly six months, with individual differences. The task tested repeating compressed sentences, not understanding an entire engineering book. | Support speed adjustment and practice, while making no promise of extreme speed or universal improvement. Let comprehension determine the useful rate. |
| [Murphy et al., 2022](https://doi.org/10.1002/acp.3899) | In lecture-video experiments, comprehension costs were small up to twice-normal playback and increased beyond that. Videos, participants and tasks differ from blind screen-reader use and dense technical TTS. | Offer a broad rate range but start at normal speed. Treat high rates as a user option, not a recommended default or a proven technical-reading threshold. |
| [Roediger & Karpicke, 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x) | Experiments with prose passages found that retrieving information helped delayed retention more than equivalent additional study, although immediate outcomes differed. This was not a test of this extension. | An optional paragraph-recall mode pauses playback for the listener to explain the main point. It is a learning aid, not a comprehension score or a clinically validated intervention. |

## A practical workflow for engineering documentation

The following is a proposed routine based on those findings. The timing and
speed increments are design suggestions, not experimental results.

1. **Choose a question.** Decide what you need from the document: understanding
   an architecture, finding a configuration step, or checking an electrical
   constraint. Keep the listening task specific.
2. **Build a map first.** Listen in Headings only mode. Use the outline to pick
   a useful section. Say its relationship to the parent chapter in your own
   words. The outline is the author's headings, not an AI-generated summary.
3. **Listen to a coherent section.** Use Continuous mode and a comfortable
   language-matched voice. Hearing an English datasheet through a Hungarian
   model, or the reverse, is avoidable friction. Select the voice explicitly.
4. **Recover immediately when context slips.** Repeat the sentence, move back
   one sentence, or request Where am I. A return-history command makes it easy
   to inspect a search result and resume the earlier passage.
5. **Capture questions instead of repeatedly restarting.** Bookmark a difficult
   passage. Return later with the surrounding section. A bookmark marks a
   location; it does not automatically resolve the technical question.
6. **Retrieve, rather than only replay.** After a short coherent passage, pause
   and explain the claim, its assumptions, and how it connects to the previous
   section. For a driver document: name the input, state transition, output and
   failure mode. Revisit the source when you cannot explain a necessary link.
7. **Increase speed selectively.** Try a small change such as 1.0 to 1.1 or
   1.25 times normal. Keep the increase only if you can still explain the
   passage accurately. Slow down for unfamiliar equations, register details,
   part numbers and a less familiar language. Repeated exposure may help, but
   simply recognizing words is not proof of understanding.
8. **Review bookmarked passages in another session.** Explain them before
   replaying them. Keep a small set of useful questions rather than an
   unmanageable collection of saved locations.

For an exploratory first pass, it can be reasonable to listen faster and skip
code blocks while retaining the knowledge that something was skipped. Before
implementing or making a technical decision, inspect the relevant exact code,
units and constraints with appropriate tools. Auditory reading is useful, but
plain speech does not automatically encode every spatial relationship in a
schematic or mathematical expression.

## Preserving context in the implementation

The document index keeps heading hierarchy, source paragraph line, paragraph
identity, semantic block type and bounded sentence text. A sentence is the
smallest normal replay unit. Long sentences are split into bounded pieces;
those pieces are not claimed to be linguistic sentences.

Tables are spoken with column names associated with each value. Images expose
the author's alt text. Code can be read or replaced by an explicit skipped-code
announcement. Raw mathematical notation is identified and bounded, but is not
converted into semantic mathematical speech. These are deliberate, visible
limits of the Markdown parser, which does not implement all CommonMark, complex
HTML, nested tables or embedded diagrams.

Saved locations are scoped by document identity and a content fingerprint.
Reopening an unchanged document resumes its segment and approximate within-
segment time. Edits reset the saved segment/bookmarks, avoiding a silently
incorrect anchor. This version does not relocate bookmarks across edits.

A native Piper process retains its voice across utterances. The next segment
can be synthesized while the current one plays. Only a small working set is
held in memory; the whole document is not pre-generated as audio. This gives
large texts responsive navigation without an unbounded audio cache.

The reader never sends documentation to an LLM or speech service. Bookmarks and
resume state remain in VS Code workspace storage. The optional voice download
feature contacts the upstream model host, and source/license links can open a
browser. Built-in voice playback itself needs no network connection.

## Implemented in 0.10.0

- One package includes the six voice models, native Windows x64/Linux x64 Piper,
  phonemizer, eSpeak data and ONNX Runtime. Windows application-local C++ runtime
  DLLs are included. No Python, pip, model download or runtime installer is
  needed for bundled-voice playback.
- Heading outline, sentence/heading jumps, document search, return history,
  local bookmarks and resumed position.
- Spoken location with heading path, progress and an approximate remaining-time
  estimate based on a stated 180-word-per-minute assumption.
- Continuous mode, headings-only mode and optional paragraph recall pauses.
- Pitch-preserving playback speed, replay, a sleep timer, keyboard controls and
  media-session handlers when the VS Code host exposes them.
- Persistent native synthesis and one-segment look-ahead.

## Follow-up work requiring its own validation

1. Have blind and experienced screen-reader users test real tasks with NVDA and
   other assistive technologies. Neither DOM tests nor headless rendering proves
   real assistive-technology usability. Measure wrong turns, recovery time,
   fatigue and comprehension, not just playback speed.
2. Add sentence-accurate forced alignment before claiming word highlighting or
   exact source-word audio seeking. Current resume is approximate.
3. Consider a semantic math reader, code punctuation modes and richer table
   navigation. Do not present raw LaTeX speech as accessible mathematics.
4. Consider document queues, pronunciation dictionaries and section-level
   language markup. Automatic language detection needs explicit overrides.
5. Consider source-grounded optional summaries with citations and clear
   separation from original text. No generative summary is provided here;
   silently substituting one would risk losing conditions or qualifications.
6. A proper spaced-recall scheduler or comprehension assessment needs a separate
   design. The current recall prompt supplies no automatic correctness judgment.

## Evaluation tasks

Use both prose and technical material, including English and Hungarian. Ask a
listener to locate a section from the outline, explain its relationship to the
previous section, recover after a distraction, bookmark a constraint, inspect a
search result and return, close/reopen, and read a labelled table. Measure
successful task completion and delayed recall at individually selected rates.
Use the same source content when comparing versions, and separate novices from
experienced screen-reader users.
