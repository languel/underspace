# underspace

A drawing-first environment where every element is code. `HANDOFF.md` holds the
design and the state of this folder.

```sh
python3 -m http.server 5310
```

| Path | What |
|---|---|
| `/` | goes to the app, keeping the query (`/?relay`, `/?demo`) |
| `/app/` | the product ([app/README.md](app/README.md)) |
| `/spike-a/` | spike A, the space: a throwaway ([spike-a/README.md](spike-a/README.md)) |
| `/spike-b/` | spike B, the object: a throwaway ([spike-b/README.md](spike-b/README.md)) |

The same paths are published at <https://languel.github.io/underspace/>. A new
tool is a new folder beside these, added to the `cp` line in
`.github/workflows/pages.yml`.

```sh
npm test
```
