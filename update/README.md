# Doudou Code update runbook

This directory is the canonical procedure for producing Doudou Code updates. A future Codex instance must follow it whenever the user says **"deploy an update"**, **"publish a release"**, or **"build the DMG for my friends"**.

Read, in order:

1. [`VERSIONING.md`](./VERSIONING.md)
2. [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md)
3. [`../docs/operations/release.md`](../docs/operations/release.md) for signing and updater internals

## Release contract

- Friends use the **stable** update channel.
- A public release is produced only from a clean commit on `main` that belongs to `origin/main`.
- The user validates the development build before a stable version is created.
- The distributable is the signed and notarized DMG downloaded from GitHub Releases, never the dev application and never an ad-hoc local archive.
- The workflow builds Apple Silicon and Intel variants and publishes the ZIPs, blockmaps, and `latest-mac.yml` required by the in-app updater.
- The application identity stays `io.github.sipiyou39.doudoucode` and every public build uses the same Developer ID signing identity.
- A version number and Git tag are immutable once published.
- Publishing or tagging requires explicit user authorization because it changes external state.

## What "deploy an update" means

Unless the user explicitly narrows the request, the agent must:

1. inspect the current branch, worktree, package versions, latest stable GitHub Release, Apple secret names, and workflow state;
2. choose the next version using `VERSIONING.md` and state that choice before publishing;
3. run the complete validation gate;
4. update every release package version with the repository script;
5. commit and push the release preparation on `main`;
6. create and push the immutable `vX.Y.Z` tag;
7. monitor **Doudou Code Desktop Release** until it succeeds;
8. verify all required assets and `latest-mac.yml` in the public release;
9. perform or clearly hand off the clean-Mac installation/update smoke test;
10. return the stable share link: `https://github.com/sipiyou39/GaiWork/releases/latest`.

If signing credentials, Apple membership, user approval, or another release prerequisite is missing, stop before tagging and report the exact blocker. Never work around missing signing by distributing an unsigned DMG to friends.

## Update experience delivered to friends

After the first DMG installation, Doudou Code checks for updates 15 seconds after launch and every four minutes while open. The update appears in the sidebar, Settings, and **Doudou Code → Check for Updates…**. The user chooses when to download and when to restart. Skipped versions update directly to the newest stable release.

Development builds and unpackaged applications intentionally have automatic updates disabled.
