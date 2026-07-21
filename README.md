# Doudou Code

Doudou Code is a workflow-focused fork of [T3 Code](https://github.com/pingdotgg/t3code), a desktop and web interface for coding agents such as Codex, Claude, Cursor, and OpenCode.

The fork keeps a runtime identity that is fully isolated from upstream T3 Code, so both applications can run side by side without sharing application state, URL handlers, preview sessions, or update feeds.

## Runtime isolation

| Surface              | Doudou Code identity                                   |
| -------------------- | ------------------------------------------------------ |
| Product name         | `Doudou Code`                                          |
| macOS/Windows app ID | `io.github.sipiyou39.doudoucode`                       |
| App protocol         | `doudou-code://` (`doudou-code-dev://` in development) |
| Desktop data         | `~/Library/Application Support/doudou-code` on macOS   |
| Backend state        | `~/.doudou-code`                                       |
| Preview partitions   | `persist:doudou-code-preview-*`                        |
| MCP browser server   | `doudou-code`                                          |
| Update repository    | `sipiyou39/GaiWork`                                    |

Existing `.gaiwork` and GaiWork Application Support directories are read as compatibility fallbacks, so the final identity change does not hide conversations, settings, or companion positions. Fresh installations create only Doudou Code paths. Internal `@t3tools/*` package names and `T3CODE_*` environment-variable aliases remain source-compatible with upstream; they are implementation APIs rather than runtime product identity.

Provider authentication remains shared unless you configure a separate provider home. For example, Doudou Code can reuse an existing Codex login while keeping all Doudou Code UI, backend, preview, and desktop preferences separate from T3 Code.

## Development

### Requirements

- Node.js `^24.13.1`
- pnpm `11.10.0`
- At least one authenticated coding-agent provider

Install Vite+ if `vp` is not already available:

```bash
curl -fsSL https://vite.plus | bash
```

Install dependencies and launch the isolated desktop development app:

```bash
pnpm install --frozen-lockfile
pnpm run dev:desktop
```

The development app appears as `Doudou Code (Dev)` and uses its own bundle ID suffix, protocol, state directories, and Dock icon.

### Verification

```bash
pnpm exec vp check
pnpm exec vp run typecheck
pnpm exec vp test
pnpm exec vp run build:desktop
```

### Build a local macOS artifact

```bash
pnpm run dist:desktop:dmg:arm64
```

Release packaging refuses to run unless the current branch is `main` and the worktree is clean. GitHub release builds may use a detached checkout, but its commit must belong to `origin/main`.

Local artifacts are unsigned by default. Public macOS releases use the signed and notarized workflow documented in [Release and automatic updates](./docs/operations/release.md).

## Providers

Install and authenticate at least one provider before use:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `cursor-agent login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

## Documentation

The upstream documentation remains applicable to the shared architecture:

- [Getting started](./docs/getting-started/quick-start.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers/codex.md)
- [Operations](./docs/operations/ci.md)
- [Reference](./docs/reference/encyclopedia.md)

Doudou Code retains the upstream MIT license. See [LICENSE](./LICENSE).
