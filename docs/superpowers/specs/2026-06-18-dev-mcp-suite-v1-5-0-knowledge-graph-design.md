# Dev MCP Suite v1.5.0 Knowledge Graph Design

## Summary

`v1.5.0` introduces the first knowledge-graph layer for Dev MCP Suite. The release is intentionally narrow and focuses on three capabilities only:

- `memory_link`
- `memory_global_recall`
- `memory_dedup`

The goal is to improve note connectivity, cross-project discovery, and duplicate detection without making embeddings mandatory and without forcing existing users through a hard migration.

This release must remain backward-compatible with existing vaults and must degrade gracefully when semantic retrieval is unavailable.

## Goals

- Add explicit note-to-note linking with resolvable references and backlinks.
- Add cross-project recall that still prefers the active project first.
- Add duplicate-note discovery with safe, reviewable suggestions.
- Keep retrieval useful even when no embeddings provider is configured.
- Avoid destructive automation in any dedup flow.
- Create a foundation that later releases can observe, score, and maintain.

## Non-Goals

- Auto-merging or auto-deleting notes.
- Introducing a monolithic graph subsystem with many unrelated features.
- Requiring embeddings as a prerequisite for graph features.
- Shipping observability, lifecycle cleanup, or automated repair workflows in this release.
- Changing the existing public tool surface outside the three scoped tools unless strictly required for compatibility.

## Release Scope

`v1.5.0` includes exactly these tools and behaviors:

1. `memory_link`
2. `memory_global_recall`
3. `memory_dedup`

Future work is explicitly deferred:

- `v1.5.1`: Observability
- `v1.5.2`: Lifecycle

## User Problems

Current retrieval is strong within a single project, but the suite still lacks a first-class model for relationships between notes. The main pain points are:

- users cannot explicitly connect notes and traverse those connections reliably;
- similarly named notes across projects are hard to distinguish and reuse safely;
- duplicate notes accumulate over time with no guided cleanup path;
- semantic recall quality depends too heavily on whether embeddings are configured.

The knowledge-graph release solves these by adding link awareness, global lookup, and safe dedup suggestions while keeping the existing retrieval architecture intact.

## Design Principles

### Backward-compatible first

Existing vaults must continue to function without manual migration. Graph metadata can be introduced lazily and rebuilt later if needed.

### Safe by default

No destructive actions happen automatically. When ambiguity exists, the system should return candidates rather than silently guessing.

### Embeddings are optional, not required

Graph features must still provide value with keyword and deterministic retrieval only. Semantic enhancements improve quality but are not a hard dependency.

### Same-project bias

When resolving links or ranking recall results, the active project has priority. Global behavior is additive, not a replacement for project locality.

### Rebuildable state

Any derived graph or link index must be reconstructible from note content and note metadata.

## Capability 1: `memory_link`

### Purpose

`memory_link` provides explicit note-link parsing, resolution, and backlink support.

### Supported Link Syntax

The tool supports both:

- `[[id]]`
- `[[title]]`

It also supports explicit cross-project override syntax:

- `[[project:id]]`
- `[[project:title]]`

### Resolution Rules

Link resolution follows this order:

1. If the link contains an explicit project prefix, resolve within that target project.
2. Otherwise, search the active project first.
3. If no same-project match exists, fall back to global search.
4. If multiple valid matches remain, return ambiguity information and candidate matches.
5. If no match exists, return an unresolved-link result rather than fabricating one.

### Backlinks

The tool must expose backlink information for a note so users can inspect inbound relationships. Backlinks are derived data and should not require separate manual authoring.

### Expected Behavior

- Same-project linking should feel local and predictable.
- Title-based linking should remain ergonomic.
- Cross-project references should be explicit when needed.
- Ambiguous links should be surfaced clearly.

## Capability 2: `memory_global_recall`

### Purpose

`memory_global_recall` retrieves relevant notes across multiple projects while preserving a strong active-project bias.

### Retrieval Strategy

Global recall should be layered rather than all-or-nothing:

1. Search/rank the active project first.
2. Expand to global candidates only as a fallback or augmentation layer.
3. Apply graph-aware boost after candidate generation.
4. Return results with enough metadata to explain where they came from.

### Ranking Model

The ranking model should use a soft graph boost. Graph connectivity helps reorder candidates, but it must not act as a hard filter that hides otherwise relevant notes.

Possible ranking inputs:

- lexical/keyword match
- semantic similarity, if embeddings are available
- graph/link proximity
- same-project prior
- note freshness or other existing recall signals if already available in the current architecture

### Behavior Without Embeddings

If no embeddings model is configured, `memory_global_recall` must still work by combining:

- keyword/deterministic candidate retrieval
- same-project prioritization
- graph-based soft boosting

This ensures cross-project recall remains usable in “zero semantic config” environments.

### Output Expectations

The tool should make it clear whether a result came primarily from:

- active-project recall
- global fallback
- graph-supported re-ranking
- semantic retrieval, if enabled

That transparency matters for debugging user trust later, especially in `v1.5.1` observability.

## Capability 3: `memory_dedup`

### Purpose

`memory_dedup` identifies likely duplicate notes and suggests merge candidates.

### Safety Policy

This tool is advisory only in `v1.5.0`.

It must:

- suggest possible duplicates;
- explain why the pair/group was flagged;
- avoid deleting or merging anything automatically.

It must not:

- auto-delete notes;
- auto-merge notes;
- rewrite content without an explicit future tool designed for that purpose.

### Default Threshold

The default duplicate threshold is `0.90`.

That threshold should be overridable, but the default should favor precision over aggressive cleanup.

### Matching Signals

Dedup suggestions may consider:

- normalized title similarity
- content overlap
- link neighborhood similarity
- semantic similarity if embeddings are available
- metadata similarity if cheap and already available

### Output Expectations

The output should contain enough information for manual review, such as:

- note identifiers
- titles
- project locations
- similarity score or confidence
- a short explanation of why the pair was flagged

## Backfill and Migration Strategy

### Chosen Strategy

The backfill strategy is hybrid:

- lazy auto-backfill on first graph-tool use;
- explicit rebuild/backfill path available for repair and mass reindexing.

### Why Hybrid

Pure manual backfill adds friction for existing users. Purely automatic migration hides too much state change and makes repair harder.

Hybrid gives the best trade-off:

- old vaults keep working immediately;
- derived graph state appears when needed;
- operators still have a deterministic rebuild path if state gets stale or corrupted.

### Requirements

- First-time graph access must not require a full blocking migration unless unavoidable.
- Backfill must be resumable or rebuildable.
- Any rebuild path should produce the same derived state from the same note corpus.

## Storage Model

### Chosen Model

Storage is hybrid.

### Intent

Per-note and per-project source data stays close to existing storage boundaries, while link/global lookup indexes may be maintained in a derived structure optimized for recall and traversal.

### Requirements

- Graph state must be derived from canonical note content and metadata.
- Rebuilding graph state must be possible without manual note editing.
- Storage decisions should not break existing project isolation assumptions.
- Global lookup structures must still preserve project attribution for every note.

## Tool Surface

The MCP surface remains separated into three tools:

- `memory_link`
- `memory_global_recall`
- `memory_dedup`

### Why Separate Tools

Separate tools are easier to reason about, easier to test, and easier to evolve independently.

They also map cleanly to user intent:

- linking/traversal
- cross-project search
- duplicate analysis

A monolithic graph tool would complicate input/output contracts too early.

## Fallback Behavior Matrix

### Fully configured environment

If keyword, embeddings, and graph metadata are all available:

- use standard retrieval candidate generation;
- use semantic similarity where supported;
- apply graph-aware soft boosting;
- return explanatory provenance.

### No embeddings configured

If embeddings are unavailable:

- use keyword/deterministic candidate generation;
- still use same-project bias and graph-aware boosting;
- maintain tool usability without surfacing provider errors as hard blockers.

### No graph-derived state yet

If graph state is missing:

- trigger lazy backfill where appropriate;
- if backfill cannot complete immediately, fall back to non-graph retrieval behavior and explain that graph augmentation is incomplete.

## Error Handling Expectations

### Ambiguous links

Return candidate matches and ambiguity metadata.

### Missing project target

Return a clear unresolved-reference result.

### Missing embeddings provider

Do not fail the request if semantic retrieval is optional for that path.

### Derived-state drift

Expose enough information for future rebuild/repair tooling rather than silently masking corruption.

## Testing Implications

`v1.5.0` should add tests for at least:

- same-project `[[title]]` resolution
- same-project `[[id]]` resolution
- explicit cross-project override resolution
- ambiguous title resolution behavior
- unresolved link behavior
- global recall preferring same-project hits
- global recall fallback to other projects
- dedup suggestions with default threshold `0.90`
- dedup non-destructive behavior
- recall fallback behavior when embeddings are unavailable
- lazy backfill behavior for pre-existing vault state

## Open Implementation Notes

These are implementation notes, not unresolved design questions:

- The graph layer should reuse as much existing note indexing infrastructure as practical.
- Derived state should be cheap to invalidate and rebuild.
- Output shapes should be designed for future observability fields, even if `v1.5.0` does not yet expose all diagnostics.
- Existing recall-mode behavior introduced in `v1.4.0` should remain conceptually compatible with the new global recall path.

## Risks

### Scope creep

Knowledge graph features can expand very quickly. The release avoids that by limiting scope to three tools only.

### Ambiguity explosion

Title-based linking across projects can create ambiguity. This is handled with same-project bias and explicit project override syntax.

### Over-dependence on semantic infrastructure

If graph quality depends too much on embeddings, many users lose value. This is mitigated by requiring a strong keyword/deterministic fallback path.

### Hidden state issues

Any lazy derived-state system can drift or fail partially. This is mitigated by keeping state rebuildable and by preserving an explicit rebuild path.

## Out of Scope for Later Releases

### `v1.5.1` Observability

Likely follow-up concerns:

- graph/index health visibility
- recall provenance inspection
- stats/watch-style diagnostics
- duplicate trend metrics

### `v1.5.2` Lifecycle

Likely follow-up concerns:

- cleanup workflows
- archival guidance
- merge-assist flows
- stale-link repair flows

## Final Recommendation

Ship `v1.5.0` as a focused knowledge-graph release with three separate tools, hybrid backfill, safe dedup suggestions, and graph-aware recall that still works without embeddings.

This gives Dev MCP Suite a meaningful relationship layer without overcommitting the release to automation, destructive behavior, or provider-specific assumptions.
