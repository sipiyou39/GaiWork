# Doudou Code companion assets

The experimental `experiment/companions` branch contains nine runtime companion atlases under
`apps/web/public/companions`. Each identity ships only its WebP spritesheet and animation manifest;
source PNGs, individual frames, previews, the handoff archive, and the prototype player are not
part of the application bundle.

The macOS runtime groups companions into one transparent overlay per display. The original
one-window-per-companion prototype exceeded the nine-companion resource budget; the grouped
renderer keeps one shared animation scheduler and no network connection. Validate the budget after
a desktop build with `pnpm --filter @t3tools/desktop performance-test:companions`.

Local preferences live under **Settings → Companions**. Desktop and sidebar sizes are independent;
desktop positions remain normalized to their display when the size changes. The same page can hide
all desktop companions without removing assignments, choose the default desktop visibility for new
assignments, and reset saved positions.

The source pack did not include a license or provenance declaration. Do not distribute these assets
from a release build until the asset owner and permission terms are recorded in the project notices.
