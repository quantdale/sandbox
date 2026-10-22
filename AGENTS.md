# sandbox — Agent Instructions

This is the canonical repository-level contract for `quantdale/sandbox`.

## Repository identity

This repository is a collection of learning experiments, currently centered on three click-counter generations with different backend stacks:

- `Click-counter/`: Python backend.
- `click-counter-v2/`: Go backend.
- `click-counter-v3/`: Rust backend.

Their browser frontends and backend implementations are independent experiment surfaces. There is no single root package/build/test command and no requirement that all versions converge.

## Required reading

1. `README.md` and `.agent/STATE.md`.
2. `.agent/PLANNER_HANDOFF.md` and any active `.agent/EXECUTION_PROMPT.md`.
3. Inspect the specific experiment directory, manifests, and source before planning work.

Always name the target experiment explicitly in plans, commits, validation, and handoffs.

## Experiment discipline

- Preserve earlier versions as historical/learning snapshots unless a task explicitly requests migration or deletion.
- Do not propagate a change across v1/v2/v3 merely for consistency; each propagation needs a reason and validation.
- Do not infer commands across languages. Python, Go, and Rust versions have different toolchains.
- `click-counter-v3/backend/target/` is generated build output that is currently tracked. Do not use it as implementation evidence and do not add more generated artifacts by default. Cleanup is a separate hygiene task, not permission for destructive deletion during unrelated work.
- Sandbox status does not waive verification: run the relevant language/tool/browser checks that actually exist for the experiment changed.

## Documentation discipline

When an experiment's purpose, stack, run commands, ports, API contract, persistence behavior, or status changes, update living documentation for that experiment or the root index. Historical experiments should remain historically intelligible.

Evidence precedence is `current source/manifests and executable validation` > `active state/prompt` > `living docs` > `historical records` > `assumptions`.

## Git safety

Inspect status and diffs. Do not wipe experiment directories, generated history, or unrelated changes to obtain a clean state. Do not force-push or rewrite history. Keep commits scoped to the named experiment and distinguish intentional cleanup from product/learning changes.

## Cross-project UX, DX, and AX principles

Cut taglines, helper text and secondary labels. If a screen needs them to make sense, fix the layout.

Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything.
