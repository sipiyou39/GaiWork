# Stable release checklist

Complete every checked section in order. Do not tag a release while any mandatory item is unresolved.

## 1. Authorization and repository state

- [ ] The user explicitly approved the exact dev build and asked to publish it.
- [ ] `git branch --show-current` returns `main`.
- [ ] The intended source changes are committed.
- [ ] `git status --short` is empty, including untracked files.
- [ ] `git fetch origin` succeeds and the release commit belongs to `origin/main`.
- [ ] No unrelated user work is included.

## 2. Determine the version

- [ ] Read `VERSIONING.md`.
- [ ] Inspect the four package versions.
- [ ] Inspect `gh release list -R sipiyou39/GaiWork` and `git tag --list 'v*' --sort=-version:refname`.
- [ ] Choose `PATCH`, `MINOR`, or `MAJOR` from the actual change set.
- [ ] Confirm that neither the version nor its `vX.Y.Z` tag has ever been published.

Synchronize versions:

```bash
version=X.Y.Z
node scripts/update-release-package-versions.ts "$version"
```

## 3. Signing and publishing prerequisites

- [ ] The GitHub repository is public.
- [ ] Apple Developer Program membership is active.
- [ ] The Developer ID Application certificate is valid and is the same identity used for prior stable releases.
- [ ] The App Store Connect notarization key is valid.
- [ ] GitHub Actions exposes these secret names:
  - `CSC_LINK`
  - `CSC_KEY_PASSWORD`
  - `APPLE_API_KEY`
  - `APPLE_API_KEY_ID`
  - `APPLE_API_ISSUER`
- [ ] The bundle ID is still `io.github.sipiyou39.doudoucode`.
- [ ] The update repository is still the intentional Doudou Code release repository.

Secret values must never be printed into logs, chat, commits, or documentation.

## 4. Validation gate

Run from the repository root:

```bash
vp check
vp run typecheck
vp test
vp run test
vp test run scripts/lib/brand-assets.test.ts
vp run build:desktop
vp run test:desktop-smoke
vp run release:smoke
git diff --check
```

If an Icon Composer project or one of its generated iOS, Windows, Linux, or web assets changed, also run:

```bash
vp run icons:check
```

That check requires Icon Composer 2.x. A missing compatible exporter is a release blocker only when those Icon Composer-backed assets changed. The shared macOS PNG is validated independently by `scripts/lib/brand-assets.test.ts` and does not require Icon Composer.

If native mobile code changed, also run:

```bash
vp run lint:mobile
```

Do not ignore a failure or weaken a check to make the release pass. Fix it or stop and report the blocker.

## 5. Release preparation commit

Review the complete release diff, then commit the synchronized versions:

```bash
git add apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json
git commit -m "chore(release): prepare Doudou Code v$version"
git push origin main
```

If the approved feature work is still uncommitted, commit it separately before the release preparation commit. Never hide feature work inside the version-only commit.

## 6. Publish

Reconfirm the clean state and tag target:

```bash
git status --short
git show --no-patch --decorate HEAD
git tag --list "v$version"
```

Then:

```bash
git tag "v$version"
git push origin "v$version"
```

The tag triggers `.github/workflows/release.yml`. Monitor it until completion. Do not announce success merely because the tag push succeeded.

## 7. Verify the GitHub Release

- [ ] Workflow **Doudou Code Desktop Release** is green.
- [ ] Release name is `Doudou Code vX.Y.Z`.
- [ ] Release is public, non-draft, non-prerelease, and marked latest.
- [ ] Apple Silicon DMG exists.
- [ ] Intel DMG exists.
- [ ] Apple Silicon ZIP exists.
- [ ] Intel ZIP exists.
- [ ] Matching blockmaps exist.
- [ ] `latest-mac.yml` exists and references both architectures with valid SHA-512 hashes.
- [ ] No required asset was manually renamed or deleted.

## 8. Installation and updater smoke test

For the first stable release, install the correct DMG on a clean Mac and confirm Gatekeeper accepts it without bypass instructions.

For every update chain validation:

1. keep the previous stable version installed;
2. publish the higher patch version;
3. use **Doudou Code → Check for Updates…**;
4. download and restart from the in-app control;
5. confirm **About Doudou Code** shows the new version;
6. confirm conversations, settings, companion assignments, positions, and update channel remain intact.

## 9. Handoff

Return:

- the published version and commit;
- the successful workflow link;
- the GitHub Release link;
- `https://github.com/sipiyou39/GaiWork/releases/latest` as the link to send friends;
- which DMG Apple Silicon and Intel users should choose;
- the exact checks and smoke tests completed;
- any remaining manual verification, stated explicitly.

## Failed release policy

- Before a tag exists: fix the source, rerun validation, and publish normally.
- After a tag exists but before a public Release exists: diagnose the workflow. Do not move the tag without explicit user authorization and a written reason.
- After a public Release exists: publish a new higher patch version. Never replace the published binaries in place.
- For a severe regression: mark the bad release clearly, stop serving it as latest if necessary, fix forward, and publish a higher patch. Existing installations must always see a monotonically increasing version.
