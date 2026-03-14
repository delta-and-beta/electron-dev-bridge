# Accumulated Wisdom

## API Design
- **A parameter that appears in the response but doesn't affect behavior is worse than no parameter** — it actively misleads users into thinking they're controlling something they're not (2026-03-14-publish-readiness.md)

## Path Handling
- **Validate raw inputs before path transformation functions** — `resolve()`, `join()`, and `normalize()` always return values, masking missing inputs. Check before transforming. (2026-03-14-publish-readiness.md)

## Security
- **Always use `JSON.stringify()` to interpolate untrusted strings into generated JavaScript** — manual quote escaping is error-prone and vulnerable to backslash-escape bypass (2026-03-14-publish-readiness.md)
- **Run a dedicated security scan before publishing** — code review misses path leaks, `.gitignore` gaps, and identity exposure that a targeted scan catches (2026-03-14-publish-readiness.md)

## Testing
- **Use `mkdtempSync()` + inline fixtures for file-reading tests** — never reference external files or absolute paths. Tests must be self-contained and portable. (2026-03-14-publish-readiness.md)

## Publishing
- **After creating any new top-level directory for consumers, immediately check `package.json` files** — it's easy to forget, and `npm pack --dry-run` is the verification step (2026-03-14-publish-readiness.md)
- **Verify documentation claims against actual code** — tool descriptions, env var references, and parameter docs are user-facing contracts, not aspirational notes (2026-03-14-publish-readiness.md)

## Process
- **Multi-agent production scan before publish** — catches issues across categories (bugs, security, docs, DX) that a single-pass review misses (2026-03-14-publish-readiness.md)
