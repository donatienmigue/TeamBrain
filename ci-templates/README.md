# TeamBrain CI templates

Drop-in GitHub Actions workflows for running TeamBrain's CI-side automation.
Copy the ones you want into `.github/workflows/` in the repo that holds the
brain (`.teambrain/`), then set the required secrets.

| Template | Copy to | Trigger | What it does | Secrets |
|---|---|---|---|---|
| [`lint.yml`](./lint.yml) | `teambrain-lint.yml` | PR touching `.teambrain/**` | `tb lint --require-evidence` on the brain; blocks the PR on any violation (exit 3). | — |
| [`distill.yml`](./distill.yml) | `teambrain-distill.yml` | Weekly (Mon 06:00 UTC) + manual | `tb distill`: cluster new sessions → draft/dedup/gate → open a proposals PR. | `ANTHROPIC_API_KEY` |
| [`digest.yml`](./digest.yml) | `teambrain-digest.yml` | Weekly (Mon 13:00 UTC) + manual | `tb digest`: post a people-free weekly summary to Slack. | `TEAMBRAIN_SLACK_WEBHOOK` |
| [`sessions-rotation.yml`](./sessions-rotation.yml) | `teambrain-sessions-rotation.yml` | Monthly (1st, 04:00 UTC) + manual | Squash the `teambrain/sessions` orphan branch to one commit (records kept, history dropped) and force-push. | — |

## Notes

- **`GITHUB_TOKEN`** is provided automatically by Actions; `distill.yml`
  requests `pull-requests: write` so `gh` can open the memory PR, and
  `sessions-rotation.yml` requests `contents: write` to force-push the orphan
  branch. Nothing here can write to `main` — the distiller only opens PRs.
- **Sessions branch:** `distill.yml` and `digest.yml` fetch
  `teambrain/sessions` before running; the fetch is best-effort (`|| true`) so
  a first run with no branch yet still succeeds.
- **Privacy:** `digest.yml` transmits only aggregate counts and memory ids/
  titles to Slack — never per-person data (enforced structurally in the
  aggregator, Tech Brief §4.7). `distill.yml` sends only clustered metadata to
  the LLM provider under the team's own key (TB3).
- **Validate before committing:** run
  [`actionlint`](https://github.com/rhysd/actionlint) over these files
  (`actionlint ci-templates/*.yml`) — it type-checks the workflow schema and
  shellchecks every `run:` block.
