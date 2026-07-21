# Version numbering

Doudou Code stable versions use strict semantic versioning:

```text
MAJOR.MINOR.PATCH
```

Examples: `0.1.0`, `0.1.1`, `0.2.0`, `1.0.0`.

The Git tag is the same version prefixed by `v`: version `0.1.1` uses tag `v0.1.1`.

## Which number to change

| Change                                                                                                 | Increment | Example           |
| ------------------------------------------------------------------------------------------------------ | --------- | ----------------- |
| Bug fix, polish, performance or reliability improvement with compatible behavior                       | `PATCH`   | `0.1.0` → `0.1.1` |
| New user-facing capability or substantial compatible feature                                           | `MINOR`   | `0.1.1` → `0.2.0` |
| Intentional incompatibility in persisted data, public protocol, update identity, or supported workflow | `MAJOR`   | `0.9.4` → `1.0.0` |

Before `1.0.0`, Doudou Code still follows this policy: ordinary new features increment `MINOR`; fixes increment `PATCH`. Do not use `PATCH` merely because the project is pre-1.0.

The first public friends release is `0.1.0` unless a stable release already exists. Always inspect GitHub Releases and the four package manifests before deciding.

## Invariants

- The new version must be strictly greater than every stable version already published.
- Never reuse a version, even if an earlier workflow failed after creating its GitHub Release or tag.
- Never delete and recreate a public tag to replace its contents.
- Never publish a stable tag containing a prerelease suffix.
- Nightly versions are separate and use the repository's generated format, such as `0.1.1-nightly.20260721.1`; they are never sent to friends as stable builds.
- A stable release must not be marked draft or prerelease.
- Preserve the bundle ID and signing identity. Changing either breaks the existing update chain even if the semantic version increases.

## Synchronizing package versions

Do not edit package versions one by one. From the repository root run:

```bash
version=0.1.0
node scripts/update-release-package-versions.ts "$version"
```

The script synchronizes:

- `apps/server/package.json`
- `apps/desktop/package.json`
- `apps/web/package.json`
- `packages/contracts/package.json`

Review the diff and ensure all four contain exactly the chosen version before committing.
