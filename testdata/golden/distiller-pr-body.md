## TeamBrain distiller — 2 proposed memories

One row per candidate: merge what reads true, drop the rest with the commands below. Every file passes `tb lint --require-evidence`.

| Class | Title | Evidence | Novelty | Score | Supersedes |
| --- | --- | ---: | ---: | ---: | --- |
| learning | Pin the sqlite-vec version | 3 | 0.80 | 2.40 | 01J8YCTS0000000000000000 |
| learning | Retry the S3 client | 3 | 0.80 | 2.40 | — |

### Candidate detail

<details>
<summary><b>Pin the sqlite-vec version</b> — learning · ⚠ supersedes</summary>

*File:* `memories/learnings/01JDGOLD02000000000000000B-pin-the-sqlite-vec-version.md` · *Evidence:* 2 session(s) · 1 commit(s) (`abc1234`)

Body for Pin the sqlite-vec version.

</details>

<details>
<summary><b>Retry the S3 client</b> — learning</summary>

*File:* `memories/learnings/01JDGOLD01000000000000000A-retry-the-s3-client.md` · *Evidence:* 2 session(s) · 1 commit(s) (`abc1234`)

Body for Retry the S3 client.

</details>

### ⚠ Supersedes existing memories

- **Pin the sqlite-vec version** supersedes `01J8YCTS0000000000000000` — opposite rule

### Partial accept

To drop a candidate, delete its file on this branch and push; the rest
merge as-is:

```sh
# git rm "memories/learnings/01JDGOLD02000000000000000B-pin-the-sqlite-vec-version.md"
# git rm "memories/learnings/01JDGOLD01000000000000000A-retry-the-s3-client.md"
git commit -m "distill: drop declined candidates" && git push
```
