# Current State

**Status:** MULTI_EXPERIMENT_SANDBOX

The root currently contains three click-counter experiment generations: a Python-backend version, a Go-backend v2, and a Rust-backend v3, each with browser frontend material. There is no canonical root runtime or single validation command.

The v3 Rust backend currently has tracked `target/` build output in the repository tree. This documentation sweep records that hygiene condition but does not delete or rewrite generated files.

## Validation status

No experiment was executed or rebuilt during this docs-only sweep. No fresh runtime/build/test PASS is claimed.

## Continuation

Future work must identify the exact experiment being changed and discover validation from that experiment's own manifests/source. Preserve other versions unless an explicit migration/cleanup task says otherwise.
