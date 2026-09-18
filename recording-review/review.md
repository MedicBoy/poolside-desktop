# Live recording review

Source: `C:\Users\nicho\Videos\Screen Recordings\Screen Recording 2026-09-17 211331.mp4`

Duration: 45.589 seconds, 1652 x 1012, 30 fps. Reviewed extracted frames at half-second intervals over the entire recording, with full-resolution inspection of loading and Connecting screens. This is visual frame review, not inspection of every encoded frame or an input-event trace. Click counts cannot be established from pointer motion alone.

## Approximate timeline

- 0–10 seconds: game remains on its loading splash with a partially filled progress bar. The surrounding page responds to scrolling; the footer becomes visible and disappears again. This is not evidence of a whole desktop freeze.
- 10.5–11.5 seconds: first reload transition, including a black page/loading spinner, followed by the site header and Focus Mode control.
- 11.5–22 seconds: the game area remains blank/dark while the surrounding site UI remains visible.
- 22.5–24 seconds: another reload; spinner and then the game loading artwork reappear.
- 24–28 seconds: pointer activity and page scrolling accompany loading progress. The page content moves vertically inside the window; this differs from only moving the native window by its title bar.
- About 28.5–31 seconds: the game explicitly displays Connecting.
- About 32–35.5 seconds: Lucky Shot loads and its promotion appears. Back-arrow interaction occurs before the promotion is fully displayed, which illustrates why action timing needs screen-state checks.
- About 36–39.5 seconds: promotion is dismissed, then the Lucky Shot back control is used.
- About 40.5–42 seconds: main lobby with Play 1 on 1 is visible.
- About 43–45.5 seconds: table selector is visible with Berlin Platz centered. No match entry is demonstrated in this recording.

## Interpretation and limits

The successful attempt combines reloading, input, scrolling, and elapsed loading time. It supports the user's report that active interaction accompanies recovery but does not isolate whether clicks, focus, scrolling, rendering, resource loading, or connection timing caused recovery. The user separately reports the issue in regular Chrome; the clip cannot diagnose a PC fault or hardware defect.

The user confirms automatic return from the shop works, but that transition was not recorded. Treat it as user-verified rather than visible in this clip. Do not mark the freeze fixed: the existing repaint/throttling changes did not establish reliable unattended startup.

For subsequent implementation, distinguish page loaded, game loading, blank game area, Connecting, Lucky Shot, lobby, and table selection. Readiness requires recognition of an actual usable game screen. A blank frame can also be a brief normal transition (visible later in this clip), so a single dark image must not trigger a reload. Any recovery should be bounded and evaluated before matchmaking, with no random clicks after controls appear.
