# GaiWork

GaiWork is a workflow-focused fork of [T3 Code](https://github.com/pingdotgg/t3code), a desktop and web interface for coding agents such as Codex, Claude, Cursor, and OpenCode.

The first GaiWork milestone keeps the upstream architecture while giving the desktop app a fully separate runtime identity. It can therefore run beside T3 Code without reusing its application state, URL handlers, preview sessions, or update feed.

## Runtime isolation

| Surface              | GaiWork identity                                 |
| -------------------- | ------------------------------------------------ |
| Product name         | `GaiWork`                                        |
| macOS/Windows app ID | `io.github.sipiyou39.gaiwork`                    |
| App protocol         | `gaiwork://` (`gaiwork-dev://` in development)   |
| Desktop data         | `~/Library/Application Support/gaiwork` on macOS |
| Backend state        | `~/.gaiwork`                                     |
| Preview partitions   | `persist:gaiwork-preview-*`                      |
| MCP browser server   | `gaiwork`                                        |
| Update repository    | `sipiyou39/GaiWork`                              |

Internal `@t3tools/*` package names and `T3CODE_*` environment variables are intentionally retained for now. They do not identify an installed desktop application, and keeping them limits conflicts when syncing future upstream changes.

Provider authentication remains shared unless you configure a separate provider home. For example, GaiWork can reuse an existing Codex login while keeping all GaiWork UI, backend, preview, and desktop preferences separate from T3 Code.

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

The development app appears as `GaiWork (Dev)` and uses its own bundle ID, protocol, state directories, and Dock icon.

### Verification

```bash
pnpm exec vp check
pnpm exec vp run typecheck
pnpm exec vp run test
pnpm exec vp run build:desktop
```

### Build a macOS artifact

```bash
pnpm run dist:desktop:dmg:arm64
```

Local artifacts are unsigned by default. Signing and notarization require credentials and a provisioning profile issued for `io.github.sipiyou39.gaiwork`; the original T3 Code signing identity must not be reused.

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

GaiWork retains the upstream MIT license. See [LICENSE](./LICENSE).
