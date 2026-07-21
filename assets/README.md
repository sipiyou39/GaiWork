# Brand icons

The three Icon Composer projects remain the source of truth for the legacy iOS, Windows, and Linux icon families:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `text.svg` for its vector mark and `background.svg` when the background is a vector layer. Additional layers use semantic names that describe their role and placement.

The macOS desktop application and web shell have one shared Doudou Code artwork source of truth:

- `doudou-code/app-icon-macos-1024.png`
- `doudou-code/app-icon-web-apple-touch-180.png`
- `doudou-code/app-icon-web-favicon-16x16.png`
- `doudou-code/app-icon-web-favicon-32x32.png`
- `doudou-code/app-icon-web-favicon.ico`

Development, nightly, and stable builds deliberately use this same branded artwork. The macOS PNG must remain 1024×1024 with an alpha channel. Its opaque icon body fits the classic 824×824 macOS safe area, centered inside a transparent 100 px margin. The smaller web files are pre-scaled renditions of that master and are copied byte-for-byte into `apps/web/public`.

Run `vp run icons:export` from the repository root to regenerate the legacy Icon Composer assets. Run `vp test run scripts/lib/brand-assets.test.ts` to validate the shared Doudou Code artwork, its transparent safe area, all web dimensions, and the public favicon/splash copies. `vp run icons:check` additionally verifies the legacy generated assets when a compatible Icon Composer installation is available.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS source requirements

Do not restore the dark canvas surrounding the rounded-square artwork. The four corners of `doudou-code/app-icon-macos-1024.png` must have zero alpha, while the complete rounded-square body must remain opaque except for its antialiased outer edge.

The desktop release builder derives `icon.icns` and its 512 px runtime PNG directly from this source. The development launcher also watches this file and regenerates its cached ICNS whenever the source modification time changes.

When replacing the Doudou Code artwork, derive all four web renditions from the shared macOS master, copy them to `apps/web/public`, then run the brand asset test and a desktop build. Do not alter only a public copy: the test intentionally rejects any divergence from the tracked source rendition.
