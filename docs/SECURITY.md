# underspace: security audit of the control layer

15 Nov 2026. Scope: `app/` as deployed and as run locally: the relay and its
hub (`app/relay.mjs`, `app/src/relay.js`), the agent port and the brains
(`agent.js`, `engines.js`, `brain.worker.js`), the catalog, takes, pasted and
imported content, sketch frames, the deploy workflow. Method: reading the
code, and requests against a hub on a spare port and against the page.

## The model this was judged against

The owner's decision stands: the control layer is for the owner's own
machines, and **an agent the owner starts is trusted completely**. It may
write object code, which runs in the page with the page's rights. Nothing
below questions that, and nothing was added that asks an agent for
permission.

What is *not* meant to be trusted, and is what the audit looked for:

1. **a web page on another site**, open in the same browser;
2. **a file** someone else made (a take, a score to import, a pasted text);
3. **another program on the machine** (accepted, see C1);
4. **text inside the drawing** read by a model (prompt injection).

## Fixed in this pass

| | What | Where |
| --- | --- | --- |
| F1 | **Any site could join the hub as a tab.** The hub let in every request without an `Origin`, to admit programs. A browser also sends none for a plain GET from another site (an `<img>`), so any page could open `/events?tab=x`, become the newest tab and swallow every call an agent made (they then wait ten minutes for an answer). It could not answer them or read them. Now a request marked `sec-fetch-site: cross-site` with no allowed origin is refused. | `relay.mjs`, `refused()` |
| F2 | **DNS rebinding.** A site whose name is made to resolve to 127.0.0.1 talks to the hub as same-origin: its GETs carry no `Origin`, so it could read `/tools` and `/status` and hold `/events`, receiving every call (arguments and code included). The hub now answers only when `Host` is `127.0.0.1`, `localhost` or `[::1]` on its port. | `relay.mjs`, `HOSTS` |
| F3 | **A take could run any command.** Replaying a take ran whatever command each clip named, recorded or not. A take file written by hand could call `setting.set` (point the assistant's endpoint or the relay at another address, and that stays in this browser after the take is gone), `action.run`, `user.ask`, `assistant.ask`. Replay now runs only commands that are recorded, which is all a real take holds. | `space.js`, `rerun()` |
| F4 | **A caller could pass as the person.** `by` comes from the caller; `"by": "human"` over the hub was recorded in the take as the person's and did not light the agent mark. The page's own names are now prefixed (`agent:human`). | `src/relay.js`, `who()` |
| F5 | **Markup through a colour.** The stroke and fill settings were written into `innerHTML` (the mark beside the pointer); a setting holding markup became elements in the page. Settings are set by agents and by event code (`tool('stroke', …)`), which can run code anyway, so this added little, but it is closed: colours are stripped to colour characters. | `main.js`, `cssColour()` |
| F6 | **Sketch reports from any window.** The page took `{ underspace: id, out }` messages from any window; now only from its own sketch frames. | `main.js` |

Checked after: on a spare port the hub answers a program, a localhost page and
the deployed page, and refuses another site (with or without an `Origin`) and
a rebinding `Host`; the running page records a spoofed caller as
`agent:human` and writes no element from a colour. 134 tests.

**To do by hand:** the hub that is running is the old code until it is
restarted (end the agent sessions that started it, or kill the `node
app/relay.mjs` process holding port 5311).

## Open by decision (no change)

- **C1. The hub has no token.** Any program run by any user on the machine
  can call it, join as a tab, or take port 5311 before the relay does and
  then drive every tab that connects. On a single-user laptop that is the
  owner. On a shared machine (a lab) it is not: do not run the relay there
  without a token.
- **C2. Agents write code that runs in the page.** `object.code`,
  `brush.define`, `sculpt.define`, and anything through `batch.run`. Sketch
  frames are `allow-same-origin`, so a sketch is the page.
- **C3. Any page on localhost, on any port, is let in** by the hub, and so
  is every page of `https://languel.github.io`: an origin is a host, so that
  is every GitHub Pages project of the account, not only this one. Narrow
  it with `UNDERSPACE_ORIGINS=` (empty) when the deployed copy is not being
  used with the relay.
- **C4. `setting.set` can repoint the assistant and the relay**
  (`assistBase`, `relay`). An agent that is trusted may; after F3 a file
  cannot.

## Findings left for a decision

Ordered by how much they matter for the use this is built for: teaching,
where people open each other's work.

- **D1. Opening a take runs its code.** High for a classroom, by design
  everywhere else. A take holds object code, and code objects run every
  frame from the moment it loads: with the page's rights it can read
  everything in this origin's storage, change settings, and fetch anywhere.
  The same holds for `object.paste` (⌘V of copied JSON with code in it), a
  pasted sketch, and the IanniX import, which is the only one that asks
  first. Options, cheapest first: (a) a take opened *from a file* loads
  with its code held until the person lets it run, as the agent mark
  already holds agents: one glyph, no text; (b) sketches in a frame without
  `allow-same-origin`, which needs the vendored libraries inlined or served
  with CORS headers; (c) all object code in a worker or a sandboxed frame,
  which is the real boundary and the largest change (code objects read and
  return plain data already, so it is feasible). Recommended: (a) now, (c)
  before students exchange files. **Decided by the owner, 15 Nov 2026: left
  as it is.** Raise it again when files start to pass between people.
- **D2. The deployed page shares its origin** with every other project at
  `languel.github.io`: the same localStorage (takes, settings, the error
  log) and the same standing with the hub. A custom domain or a separate
  account for underspace would give it its own origin.
- **D3. A model can be steered by the drawing.** What is drawn goes into the
  prompt (names, note text, code headers), and a model that sees is shown
  the picture. A take that says "call object_code with …" in a note may be
  obeyed by a small model. It needs D1's opened-file case to matter (the
  file can already run code), so it is low now; it becomes real if D1(c)
  is done, because then the model is the way out of the sandbox. Then: mark
  the "Now" block as data in the prompt, and do not offer `object.code` in a
  turn begun over a file that is still held.
- **D4. No Content-Security-Policy.** With `new Function` and inline
  sketches a strict one is not possible; `connect-src` cannot be fixed
  either while the endpoint is a setting. Nothing to do before D1(c).
- **D5. Weights and the model server are taken on trust.** The browser
  brain downloads from Hugging Face by repository name with no pinned
  revision (`assistBrowserModel`); the endpoint engine sends the prompt
  (the drawing in short) to `assistBase`, by default this machine. Pin a
  revision when a lesson depends on one model.
- **D6. The deploy workflow** has least permissions and publishes only the
  site; its actions are pinned by tag, not by commit. `app/relay.mjs`,
  `app/eval.mjs` and `app/test/` are published with the app: harmless, and
  could be left out.
- **D7. For a server that is not localhost** (the owner's own, on the
  network), all still to do: a bind address, a token on every hub request
  and on the event stream, TLS, and an origin list without the localhost
  wildcard. The hub must not be bound to a network address as it is.

## Looked at, nothing found

- No secrets in the repository (the one string GitHub flags in
  `vendor/transformers` is a list of class names, as noted in HANDOFF).
- The only URL parameters are `?demo`, `?new`, `?gl`, `?relay`: none takes
  a value, so a link cannot name a hub, a take or a model. `?relay` in a
  link does turn the relay on in this browser and it stays on: harmless
  without a hub, but it can be turned off only from the palette.
- Icons are looked up in a fixed table; names, titles and note text are
  written as text, not markup.
- The hub reads at most 64 MB a request and listens on 127.0.0.1 only.
- The worker loads its wasm from `vendor/`, not from a CDN.
