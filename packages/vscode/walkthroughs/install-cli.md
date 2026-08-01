## The CLI does the work

This extension is deliberately thin. It does not store, index, or retrieve
memories — the `tb` CLI does, as a local process, and the extension only tells
agent mode how to launch it.

```
npm install -g @teambrain/cli
```

That keeps the native pieces (SQLite, the local embedding model) in a normal
Node process where they were built to run, instead of inside the editor.

Already have it in the repo as a devDependency? Nothing to do — a
`node_modules/.bin/tb` in the workspace is picked up automatically. To point at
a specific binary, set `teambrain.cliPath`.
