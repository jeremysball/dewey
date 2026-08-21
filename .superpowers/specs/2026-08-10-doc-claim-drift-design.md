# dewey: doc-claim drift detection, design

**Status:** approved, pending user review of this file
**Date:** 2026-08-10
**Repo:** `jeremysball/dewey` (public), pilot consumer `jeremysball/taskferry`

## Problem

Docs make claims about code (file paths, function names, behavior,
conventions) that drift out of true as the code changes underneath them.
taskferry's prior approach to this, a hand-maintained `docs/sourcemap.md`,
failed for two reasons: it was expensive to keep current, and it was read
about 4% of the time. Any replacement has to be mechanically checked
instead of hand-maintained, and it has to work whether or not anyone
remembers to read it. Think of it as a regression test for what the docs
say.

dewey is a general-purpose tool for this, not a taskferry-specific script.
taskferry is its pilot consumer.

## Two phases: discover and verify

dewey splits the work into two phases with different cost and trust
profiles.

**Discover** runs an agent against a doc and the real repo it describes,
looking for claims that no longer hold. This needs judgment. Matching
prose against code, and code against other code, isn't reducible to a
fixed pattern in the general case, so it dispatches a real model. It is
manual only: run by a person (`dewey discover`), never on a schedule and
never triggered by CI, because every run is a real dispatch cost. Its
output is a set of findings, a candidate list, not something auto-applied
or auto-committed without review.

**Verify** re-checks findings already on record. It is also agent-driven,
not a pure mechanical re-run (see "Why verify isn't purely mechanical"
below), but it targets one already-identified claim at a time, a narrower
and cheaper dispatch than discover's whole-doc scan. Verify is local and
manual (`dewey verify`), never wired into CI. Both phases stay entirely
out of any CI pipeline. Catching drift depends on someone running dewey,
not on an automated gate.

### Why verify isn't purely mechanical

The original framing treated verify as a deterministic re-run: an
existence check, an `rg` count, no model involved. That works for some
findings (a file that no longer exists) but not others. A "common sense"
finding, like why one code path special-cases something a similar path
doesn't, or many "hallucination" findings, isn't reducible to a single
grep pattern. Confirming it still holds takes the same reading judgment
that found it in the first place. Verify therefore dispatches a scoped,
narrow model call per finding instead of running a fixed script.
Deterministic tools (`rg`, existence checks) are things the model has
available while it verifies, not a replacement for it.

## Three discover modes

Discover runs against a vendored corpus of patterns, split into three
modes. A user selects one or more per run.

- **Rot**: a claim that was once true and drifted: reference rot,
  prescriptive-as-descriptive overstatement, a renamed file or function
  the doc never caught up to, a stale count.
- **Hallucination**: a claim that was never true. Nothing drifted, it was
  invented from the start (a function that never existed, a behavior
  nobody built).
- **Common sense**: logical or consistency catches that don't need a
  technical diff at all: an unexplained asymmetry between two similar
  code paths, one doc contradicting another, a justification that doesn't
  follow. This mode leans hardest on the corpus being good.

**The corpus is the actual product.** The bigger and more specific the
vendored pattern library behind each mode, the more real drift each mode
catches, compared to a generic "read this doc and use your judgment"
prompt. The corpus is generated offline, once, by a ferry dispatch as part
of dewey's own development and release process, not regenerated per
consumer repo or per run. It ships as a static asset inside the dewey
package. Every install carries the same taxonomy until dewey itself cuts a
new version.

## Findings: the bookmark ledger

Each discover run appends findings to `.dewey/findings.ndjson` in the
target repo, one JSON object per line. This file is committed to the
target repo and reviewed like any other tracked file. It isn't gitignored
scratch state; it's the standing regression ledger this whole tool exists
to produce.

### Schema

```json
{
  "id": "uuid",
  "mode": "rot | hallucination | common-sense",
  "doc": "CONTRIBUTING.md",
  "claim": "<verbatim quoted sentence/snippet the finding is about>",
  "context": "<heading or nearby anchor text, for relocation>",
  "check": "<what verify re-confirms>",
  "status": "TRUE | PARTIAL | STALE | UNVERIFIABLE",
  "discoveredAt": "ISO timestamp",
  "lastVerifiedAt": "ISO timestamp | null",
  "history": [{ "at": "ISO timestamp", "status": "...", "note": "..." }]
}
```

Verdict buckets (`status`), carried over from the earlier
`automating-repo-review` ground-truth-divergence work and kept in sync
with it: **TRUE** (claim holds), **PARTIAL** (holds with caveats,
compliance ratio under 1.0), **STALE** (was true, no longer is),
**UNVERIFIABLE** (can't be checked, e.g. no network or auth in the
verifying context).

### Anchoring: quoted text, not line numbers

A bookmark's source of truth for relocating its claim is the quoted
`claim` text itself, never a line number. Line numbers drift on every
unrelated edit to the doc. Verify relocates a claim in two tiers:

1. **Exact match**: `rg -F` the stored claim text against the current
   doc. Covers the common case where the surrounding doc changed but the
   claim sentence itself didn't move.
2. **Fuzzy fallback on a miss**: score candidate spans in the doc (roughly
   paragraph granularity) against the stored claim using an edit-distance
   similarity ratio (Levenshtein-derived, or an off-the-shelf library
   built for this: `diff-match-patch`'s approximate-match function is
   designed for exactly this "relocate text after nearby edits" problem).
   Edit distance handles insertions and deletions on its own, so the two
   strings being compared don't need to be the same length. That's the
   reason this beats prefix or positional matching, which would only tell
   you the start of the text agrees. Take the best-scoring candidate
   above a similarity threshold (~0.85 as a starting point, tunable).

If no candidate clears the threshold, the claim isn't confidently
located. That reports as its own signal, "orphaned, needs re-discovery,"
instead of silently passing or silently marking STALE.

## Executor: pluggable, taskferry first

Both discover and verify dispatch through a pluggable executor interface
(run this prompt against this repo, get structured findings back), not a
hardcoded call into taskferry. taskferry ships as the first backend, since
it's the pilot consumer and already has a worker-dispatch mechanism dewey
can reuse. This keeps dewey's core independent of any one dispatch backend
while shipping something that works day one. A second backend (a raw
opencode CLI invocation, a bare API key) can be added later without
changing dewey's core.

## Interface: Claude Code skill/plugin is the product

dewey ships primarily as a Claude Code skill/plugin. `/dewey` opens an
interactive main menu (multi-select for discover's modes, options for
verify, browsing recorded findings). Results render as markdown tables
directly in chat, not a headless report file, not stdout the user has to
parse themselves.

Mode selection works two ways:

- Through the `/dewey` menu (checkbox-style multi-select).
- Directly via `/dewey <mode> <mode> ... <flags>` for a scriptable
  invocation within the same session, skipping the menu.

A plain CLI exists underneath the skill. The actual dispatch and
schema/anchoring logic lives there, not hidden inside prompt text, so the
core isn't locked to one harness. It's secondary, though: day-to-day use
is through `/dewey`, not a standalone terminal workflow.

## Non-goals

- **No CI integration of any kind.** Neither discover nor verify runs as
  part of any pipeline, scheduled job, or merge gate. Regression
  protection comes from the committed findings ledger and the habit of
  running `dewey verify` periodically, not from automation blocking a
  merge.
- **No auto-fixing docs.** Discover proposes findings; a human decides
  what to do about each one. dewey never edits a target repo's docs
  itself.
- **No regenerating the taxonomy per repo or per run.** The corpus is a
  versioned asset dewey ships with, not something computed fresh against
  each consumer.

## Open questions carried into planning

These didn't block the design and can be resolved during
`writing-plans`/implementation instead of here:

- Exact `.dewey/findings.ndjson` conflict-resolution behavior when two
  people run `discover` concurrently on diverging branches. Likely a
  normal git merge conflict on the ndjson file, resolved by hand like any
  other text conflict. No special tooling planned yet.
- Whether `dewey verify`'s per-finding dispatch batches multiple findings
  into one model call for cost efficiency, or always dispatches one
  finding per call for isolation. Leaning toward batching within a single
  doc, but not decided.
- The exact similarity threshold for fuzzy relocation (~0.85 above is a
  starting point, not a measured value). Needs real tuning once there's a
  real corpus of findings to test against.
