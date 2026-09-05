# sandbox

A learning/experimentation repository containing multiple generations of a click-counter project rather than one canonical production application.

## Top-level experiments

- `Click-counter/` — earlier click-counter implementation with a Python backend and plain HTML/CSS/JavaScript frontend.
- `click-counter-v2/` — later experiment with a Go backend and browser frontend.
- `click-counter-v3/` — later experiment with a Rust backend and browser frontend.

The versions coexist intentionally as experiments/history. Do not assume `v3` should automatically replace or rewrite the earlier directories, and do not treat the repository root as a single buildable workspace unless a future task explicitly establishes one.

## Repository hygiene note

`click-counter-v3/backend/target/` is currently present in Git history/tree. Treat it as generated Rust build output, not source-of-truth implementation or documentation. This docs-only maintenance pass leaves existing generated artifacts untouched; future cleanup should be a deliberate repository-hygiene task with an appropriate `.gitignore` review rather than an incidental documentation edit.

## Running experiments

Each version has its own stack. Discover commands from that version's actual files (`server.py`, `go.mod`, `Cargo.toml`, frontend files) instead of inventing one root command. Validate only the experiment you changed.

## Agent guidance

Read `AGENTS.md` and `.agent/STATE.md` first. This repository is explicitly a sandbox: experimentation is allowed, but autonomous agents must still preserve version boundaries, avoid destructive cleanup, and state which experiment they are modifying.
