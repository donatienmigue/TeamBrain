# Using TeamBrain well

Installing TeamBrain takes five minutes. Getting value from it depends almost entirely on habits — what you write down, what you refuse to write down, and how quickly you delete things that stopped being true.

This document is the playbook. It assumes you've done the quick start in the [README](../README.md).

---

## 1. The operating model

TeamBrain has a weekly rhythm and it works best when someone owns it.

| When | Who | What |
|---|---|---|
| Continuously | everyone | agents read memory automatically; nobody does anything |
| Continuously | everyone | `tb propose` when you learn something the hard way |
| Weekly, ~10 min | one owner | review the distiller's proposal PR |
| Weekly, ~5 min | one owner | read the digest; retire what the no-hit list exposes |
| Monthly, ~20 min | one owner | sweep for stale memories; prune the `required` set |

That's roughly fifteen minutes a week of deliberate work. Teams that skip it end up with a brain that slowly fills with things that used to be true, which is worse than having no brain at all.

**Pick an owner.** Not a committee. The role is small but it needs a name attached — usually whoever cares most about the codebase's coherence.

---

## 2. The first week

**Day 1: import what you already have.** `tb init` pulls in `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, and your ADRs. Review that branch carefully before merging — this is your one chance to delete the accumulated cruft rather than importing it. Most teams find that a third of their existing rules file is stale, and the import is when that becomes visible.

**Day 1: set your `required` set deliberately.** After import, most memories should be `advisory`. Go through and promote only the handful that must be in front of every agent on every session. See §5.

**Days 2–5: use it normally.** Don't write memories preemptively. The system learns from what actually happens, and you'll write better memories after watching where agents actually go wrong.

**End of week 1: read the first digest.** The most valuable section is the no-hit query list — searches your agents ran that returned nothing. Each one is a documented gap in your brain, discovered by real use rather than by guessing.

**End of week 2: your first distiller PR.** Expect to reject most of it. That's the system working; the gate exists because the drafts need one.

---

## 3. What makes a good memory

This is the whole game. One well-written memory is worth twenty vague ones, because retrieval has to *choose*, and every low-value memory makes the good ones harder to surface.

### The test

A memory earns its place if it passes all four:

1. **Non-obvious.** Could an agent figure this out by reading one file? Then it doesn't need a memory.
2. **Durable.** Will this still be true in three months? If it's about a migration in flight, it belongs in the PR description, not the brain.
3. **Actionable.** Does it change what an agent *does*? "We care about performance" doesn't. "Queries in the reporting path must go through the read replica" does.
4. **Specific.** Does it name real paths, real functions, real constraints? Generic advice is noise at retrieval time.

### Good and bad, side by side

> **Bad:** *"We follow clean architecture principles and try to keep our code well-organized."*
>
> Fails all four. It's obvious, unfalsifiable, and changes nothing about what an agent does.

> **Good:** *"Domain logic in `src/domain/` must not import from `src/infra/`. The dependency direction is enforced by `pnpm lint:arch`. If you need infrastructure in a domain service, define the interface in `src/domain/ports/` and inject it."*
>
> Non-obvious, durable, actionable, specific. An agent that reads this writes different code.

---

> **Bad:** *"Be careful with the payments code, it's tricky."*
>
> Specific enough to be retrieved, useless once retrieved. It warns without informing.

> **Good:** *"Retry logic for payment provider calls lives in `src/payments/gateway-wrapper.ts`. Do not add retries at call sites — the wrapper owns idempotency-key generation, and a retry issued from a call site reuses the outer key, which the provider treats as a duplicate charge. This caused the double-authorization incident on 2026-05-31."*
>
> The *why* is what makes it stick. An agent that knows the mechanism generalizes correctly to cases the memory didn't anticipate.

---

> **Bad:** *"Use `pnpm` not `npm`. Use TypeScript strict mode. Prefer named exports. Don't use `any`. Format with Prettier. Write tests."*
>
> Six unrelated rules in one memory. Retrieval matches on the whole body, so this entry surfaces for every query and helps with none of them.

> **Good:** six memories, or — better — one memory pointing at the linter that already enforces all six.

**The corollary worth internalizing: if a tool enforces it, don't write a memory about it.** Your linter, formatter, and type checker are already telling the agent. A memory that duplicates them costs context budget and earns nothing.

### Write the surprise

The highest-value memories are almost always answers to *"why is this like this?"* — the thing that looks wrong until you know the history. That knowledge lives in people's heads, isn't derivable from the code, and is exactly what disappears when someone leaves.

---

## 4. Choosing a class

| Class | Question it answers | Example |
|---|---|---|
| `decision` | Why did we choose this? | "We use Postgres advisory locks rather than Redis for job claiming because we already require Postgres and didn't want a second availability dependency." |
| `convention` | How do we do things here? | "New API endpoints go through the versioned router in `src/api/v2/`; `v1/` is frozen." |
| `map` | Where does this live? | "Auth spans three places: middleware in `src/http/auth.ts`, token issuance in `services/identity/`, and the session table in the `identity` schema." |
| `learning` | What bit us? | "The staging seed script silently truncates `orders` if `SEED_RESET` is unset — check before debugging phantom data loss." |

If you can't decide, ask what an agent would be doing when it needs this. Orienting in unfamiliar code → `map`. About to write code → `convention`. About to change something someone already thought hard about → `decision`. About to step on a rake → `learning`.

---

## 5. The `required` budget

`priority: required` force-includes a memory in every session's context, ahead of relevance ranking. It is the strongest tool in the system and the easiest to abuse.

Every required memory is a permanent tax on your 2,000-token context budget. Ten required memories at 150 tokens each consume 75% of it, leaving almost nothing for the memories that are actually relevant to what the developer is doing right now.

**Guideline: fewer than ten required memories, and each one should be something that being wrong about is expensive.** Security boundaries, data-loss hazards, architectural invariants that are painful to unwind. Everything else is `advisory` and will surface when it's relevant — which is when it's useful.

Audit the required set monthly. It only ever grows on its own.

---

## 6. Reviewing a memory PR in 60 seconds

The distiller opens a PR with up to ten candidates. The body gives you one line per candidate: title, class, evidence count, conflict flag. You do not need to read the full bodies to triage.

**The four questions, in order:**

1. **Is it true?** You're the domain expert; the model isn't. This is the only question that requires you.
2. **Is it still going to be true?** Reject anything that describes a state of the world rather than a rule about it.
3. **Does it duplicate something?** The distiller checks similarity, but near-duplicates with different wording slip through. Two memories saying the same thing is worse than one, because retrieval splits between them.
4. **Is the class right?** Cheap to fix in review, annoying later.

**Partial acceptance is normal and encouraged.** Delete the files you don't want from the branch and merge the rest. Don't reject a whole PR for one bad candidate.

**Rejecting is not failure.** A distiller with a 30% acceptance rate is functioning correctly. If your acceptance rate is near 100%, you're probably not reading carefully.

**Watch the conflict flags.** When the distiller marks a candidate as contradicting an existing memory, one of the two is wrong and you're the only one who can say which. This is the highest-value thirty seconds in the whole workflow — a contradiction in the brain means agents are getting inconsistent instructions right now.

---

## 7. Retirement discipline

**A wrong memory is worse than a missing one.** A missing memory means the agent figures it out. A wrong memory means the agent confidently does the wrong thing, and does it consistently, across your whole team.

```bash
tb retire 01J8XQ2F7K3N5P9R1T4V6W8Y0Z "gateway wrapper removed in the payments rewrite"
```

This opens a PR that moves the file to `retired/` and marks its status. History is preserved — you can always see what the team used to believe and why it changed.

**Retire when:**
- The code it describes is gone or restructured
- The decision was reversed
- It's been superseded by a more precise memory
- It's advice that's now enforced by tooling

**Don't retire just because it hasn't been retrieved.** Required conventions are rarely *searched for* and always relevant — low retrieval is not evidence of low value for that class.

**Build the reflex:** when you make a change that invalidates a memory, retire it in the same PR as the code change. Just like updating a test. Teams that retire reactively — during a monthly sweep — always have a window where the brain is actively lying.

---

## 8. Why your memory isn't being retrieved

The most common complaint, and it's almost always one of five things.

| Symptom | Likely cause | Fix |
|---|---|---|
| Never appears for any query | It's not indexed | `tb doctor` — check `index docs` count; `tb reindex` |
| Appears for the wrong queries | Body mixes multiple topics | Split it into separate memories |
| Doesn't appear for the obvious query | Vocabulary mismatch | Use the words your team actually types. If people say "the queue", don't write only "the message broker" |
| Appears but gets cut off | Token budget exhausted by `required` | Audit the required set (§5) |
| Was retrieved, agent ignored it | Body is advisory in tone | Write imperatively: "Do X", not "It's generally preferable to X" |

**Diagnose with the same path the agent uses:**

```bash
tb doctor --json          # index freshness, doc count, retrieval latency
tb audit --last-session   # what was actually retrieved and served
```

The digest's no-hit query list is the systematic version of this: real searches that found nothing, aggregated weekly. Work that list and your brain fills the gaps that actually exist rather than the ones you imagined.

---

## 9. Reading the digest

Five minutes a week. In priority order:

**No-hit queries.** The single most actionable output. Every entry is a question your team's agents asked and your brain couldn't answer. Write those memories.

**Governance friction.** Proposal acceptance rate and median time-to-merge. Time-to-merge climbing above a few days means the loop is stalling — proposals age badly, because the sessions that justified them get further away.

**Stale memories.** Not retrieved in 90 days. Not automatically wrong (see §7), but worth a look, particularly for `learning` class entries whose incident everyone has forgotten.

**Outcome mix and friction.** Committed vs abandoned sessions, retry-heavy command patterns. Directional only — read as *"where is the team fighting the codebase?"*, not as a productivity measure.

**A note on what the digest is not.** It contains no per-person data of any kind, structurally — the aggregator physically cannot see session, tool, or author identifiers. If you're being asked to produce individual metrics from it, the answer is that the data doesn't exist, not that it's disabled.

---

## 10. Configuration worth touching

`brain.yaml` defaults are deliberately conservative. Four settings actually matter:

**`capture.level`** — `metadata` is the default and the recommendation. It records paths, exit codes, and outcomes; never content. There is no level that captures your source code.

**`redaction.level`** — raise it if your team pastes customer identifiers into prompts. Costs some signal quality; worth it in regulated environments.

**Model pin** — the distiller's model, in your CI, on your key. Pinned so distillation behaviour doesn't drift under you when a provider ships an update.

**`ttl_days` on individual memories** — for knowledge you know has a shelf life ("the auth migration runs until Q3"), set it and let the system remind you rather than trusting yourself to remember.

Leave the retrieval budgets alone unless you have a measured reason.

---

## 11. Working across tools

Serving is uniform: any MCP-capable agent gets the same memories, ranked the same way. A memory approved from a Claude Code session is served to Cursor on the next fetch.

Capture is not uniform, and it's worth knowing where the asymmetry falls. Claude Code has native lifecycle hooks, so sessions there produce full records — edits, commands, outcomes, commit attribution. Cursor has no hook surface, so sessions are inferred MCP-side, and edit telemetry, commit SHAs, and outcomes aren't available.

**Practical consequence:** your distiller's proposals will be disproportionately drawn from Claude Code sessions, because those records carry more signal. This isn't a bug and it doesn't affect what any tool *receives* — but if your team is Cursor-heavy, expect fewer proposals, and lean more on `tb propose` and hand-written memories.

---

## 12. Anti-patterns

**Importing everything on day one.** `tb init` makes it easy to bring in a 400-line rules file wholesale. Don't. Import is your best opportunity to delete.

**Writing memories preemptively.** Teams that spend a day "seeding the brain" write generic memories, because they're guessing. Wait for real friction.

**Treating the distiller as authoritative.** It proposes patterns from metadata. It doesn't know your business, hasn't read your roadmap, and cannot tell a temporary workaround from a permanent decision. That's your job, and it's why the gate exists.

**Letting the proposal queue age.** Proposals reference sessions and commits. A month later nobody remembers the context and the whole PR gets rubber-stamped or abandoned. Both are bad.

**Using the brain as documentation.** Memories are for what agents need to act correctly. Your architecture docs, onboarding guide, and runbooks are for humans and belong where humans read them. Some overlap is fine; wholesale duplication means two sources of truth that will diverge.

**Promoting to `required` to fix a retrieval problem.** If a memory isn't surfacing when it should, fix the memory (§8). Promotion masks the problem and spends context budget permanently.

**Never retiring anything.** The most common failure mode by a wide margin. A brain that only grows becomes actively harmful somewhere around month four.

---

## 13. Troubleshooting

**"Is it even working?"** Context injection is silent by design. `tb doctor` should show the daemon running, the socket reachable, and a non-zero index doc count. `tb audit --last-session` shows exactly what the last session retrieved and recorded.

**"The agent isn't using the memories."** First confirm they were served (`tb audit --last-session`). If they were, the issue is the memory's wording — see §8, and check the tone test: imperative, specific, with a reason.

**"`tb doctor` shows a brain from a different repo."** Known issue with doctor's repo scoping. Run it from your repo root; verify the brain path in its output.

**"Nothing is being proposed."** Check volume — the distiller needs roughly five-plus sessions a week to find patterns. Check that session records are reaching the remote (`git log teambrain/sessions`). Check that the CI job is scheduled and that its LLM key is set.

**"Windows clone fails."** `git clone -c core.longpaths=true`. Some memory fixture filenames exceed MAX_PATH.

**"Retrieval got slow."** `tb doctor --json` reports retrieval latency over recent calls. If the index is much larger than your memory count, `tb reindex` to rebuild it cleanly.

**Everything else.** The index is disposable — `tb reindex` fixes a surprising share of problems, and can never lose data, because the memories are markdown in your repo.
