# CT Beta 2 reference review

Source: https://www.youtube.com/watch?v=b0XIo-9K2Jc

Reviewed September 17, 2026. Reference duration: 4:24.

## Review scope

Inspected paused screens across the video, with denser sampling in the launch sequence and frame-step controls around 4:00–4:04. This was not an examination of every encoded frame. Transcript export returned unavailable; visible auto-generated captions provided partial narration. Times below are approximate. No reference software or linked installer was downloaded or run.

## Principal finding

The visible mechanism is match forfeiture. Around 4:00–4:02, secondary game windows open their menus, select Leave, and display the warning that the opponent will win. The top-right account returns to its lobby; the paired top-left account displays a win, followed by a 10-million-coin pot animation. This demonstrates the on-screen sequence, not independent verification of a live server transaction.

The bottom-left account is matched against a different opponent and also leaves. Consequently, the video does not establish that every secondary account is reliably paired with the designated main account.

## Timeline

| Approximate position | Observed content |
| --- | --- |
| 0:00–0:15 | Preview montage of controller, browser windows, and accounts. |
| 0:30–1:00 | Introduction and Windows installer. |
| 1:15–1:30 | Resource download and licensing discussion. |
| 1:45–2:00 | Controller, expandable main-account fields, transfer list, and remote strategy-loading messages. |
| 2:05–2:15 | Saved cloud-account list and account actions. |
| 2:25 | Web login opens the official game site in an incognito browser. |
| 2:35–2:45 | Bulk .plist parser; a dialog reports five unique tokens extracted from five files. |
| 2:55–3:10 | Account selection and window-count setting. |
| 3:15–3:25 | Limit control and table strategies: None, Bangkok, Rome, Seoul. |
| 3:30–3:40 | Browser launches; VPN extension/setup screen appears. |
| 3:45–3:50 | Game sessions load at localhost addresses; three game windows are present with Windows set to two. |
| 3:55–4:00 | Bangkok matches are entered. Top-left and top-right accounts are paired; bottom-left has another opponent. |
| 4:00–4:04 | Secondary accounts leave; top-left wins and shows the pot animation. |
| 4:05–4:08 | Narration claims continued operation until the chosen limit. The recording does not demonstrate completion of that limit. |
| 4:13 onward | Outro. |

## Interface inventory

- Controller header: user label, remaining time, saved-account count.
- Expandable main account: name, token, save, login, recent, domain login.
- Transfer-account list.
- Saved-account dialog: assign main or transfer role, web login, delete, upload domain file, close; multiselect instructions.
- File parser: add files, select/clear entries, assign roles, copy selection.
- Run controls: window count, limit, strategy, launch, stop, start transferring, pause.
- Debug console with remote configuration loading, click actions, and warnings.

## What remains unproven

1. **Pairing:** no explanation establishes guaranteed matching of the intended accounts, or handling of unintended opponents.
2. **Local game integration:** localhost URLs establish a local serving component; they do not reveal whether it wraps, proxies, embeds, or modifies the game.
3. **Authentication:** token fields and imports are visible, but token lifecycle, login capture, encryption, and backend storage are not exposed.
4. **Automation implementation:** click markers and console text suggest visual/coordinate automation. They do not prove the underlying library or rule definitions.
5. **Repeatability:** edited transitions and jumps in the controller timer prevent treating this as an uninterrupted reliability test.
6. **Limit semantics:** narration associates the limit with matches, but per-account versus total counting and failure handling remain unclear.
7. **Browser support:** the demonstration looks Chromium-based; it does not establish compatibility with the user's installed Opera.
8. **Software safety:** visuals cannot establish the presence or absence of loggers, droppers, or hidden network behavior.

## Additional user-supplied frames (September 17, 2026)

At the time these frames were supplied, the user had not yet tested Poolside. These are reference-video screenshots, not results from the new app.

- Image 1 shows `https://vpn-browser.com/thanks/` in a launched browser. This supports identifying the demonstrated extension's associated website; the frame does not establish its version, permissions, safety, or active connection.
- Image 2 shows a tab titled `api.ipify.org` in the top-left browser. ipify's official documentation (https://www.ipify.org/) describes this endpoint as returning the public IPv4 address. Likely purpose: checking that browser's outgoing IP. It is not itself a VPN or a location selector, and its tab alone does not show the returned IP or prove all game traffic uses the same route.
- Image 3 visibly logs downloading/extracting `resources.zip`, followed by extracting pre-cached `web_assets.zip` into a directory beginning `C:\Program Files (x86)\CT By GOD MODE`. The full destination is clipped. Combined with the localhost game URLs, this supports a local asset-serving component, but does not identify the archive contents or prove game modification.
- Image 4 visibly says `Bangkok Strategy (MAIN will use VPN extension)...`. This is evidence of role-specific configuration in that strategy. It does not say ONLY the main uses a VPN, establish what networking the secondary windows use, or generalize to every strategy.

Design implication: do not assume a single VPN configuration shared by all account windows. Network configuration and observed outgoing IP should be tracked per session if implemented. Main-only, all-session, and mixed routing remain hypotheses until independently tested. No screenshot establishes HWID/install-date spoofing or a list of identifiers the game checks.

## Implications for the requested version one

### User test of Poolside

The user reports separate account logins and retention after closing/reopening individual windows while Poolside stays running. Submitted screenshots show a signed-in main lobby and a secondary guest tutorial; the user clarified that the guest was a temporary test. The screenshots alone do not establish two authenticated named accounts simultaneously, although the user reports that behavior. Both IP checks display the same outgoing IPv4 address, consistent with the current shared network route. No IP value is copied into these notes.

Initial login sometimes displays the web shop. The user reports refresh or closing/reopening the game window returns to the logged-in game, and subsequently verified the manual Return to game control. A new shop-content heuristic waits five stable seconds before returning once per window opening; it still needs verification on the real post-login shop.

The user also reports a freeze after game reload that can clear after repeated clicks and moving the window. They explicitly confirm it happens in regular Chrome too, so it is not unique to Poolside. Root cause is unverified. The new build disables game-window background throttling and requests post-load/focus repaints as candidate mitigations, without issuing random gameplay clicks.

Subsequent 45.589-second user recording confirms the visual sequence of stalled loading, a reload followed by a blank game area, another reload with interaction/scrolling, then Connecting, Lucky Shot, lobby, and table selection. See `recording-review/review.md` for the full timeline and review scope. The user confirms auto-return works off-camera; reliable unattended game startup remains unverified. Visible vertical motion includes scrolling within the page, not solely native-window movement.

### User-confirmed game navigation

Four subsequent screenshots from Poolside and the user's explanation establish this navigation flow:

1. Optional Lucky Shot promotion: dismiss the overlay with its red circular X. This overlay is intermittent, so its absence is a normal state.
2. Lucky Shot screen underneath: use its red square back arrow at the upper left of the game area to return to the lobby. Do not confuse this with the table selector's back arrow at the lower left.
3. Main lobby: choose the green Play 1 on 1 button.
4. Table selector: use the green left/right arrows until the desired table is centered. The provided examples show Berlin Platz and Mumbai Mahal; they are navigation examples, not a request to change the preferred table.
5. Selecting the displayed table card begins entry/matchmaking, per the user. Preparing a table and entering matchmaking are distinct steps; coordinate entry only once the relevant sessions are ready.

Implementation requirements derived from this flow: recognize each screen independently, re-observe after each action, handle the Lucky Shot interruption only when present, verify the centered table by its identity rather than assuming a fixed number of arrow clicks, and do not reuse desktop coordinates across resized/arranged windows. Unrecognized screens should stop progression with an actionable status. Screenshot positions are reference evidence, not calibrated click targets. Screen recognition and this automated navigation are not yet implemented.

Confirmed user scope: Windows, official browser game at https://8ballpool.com/game, Opera preference, automated coin transfer as the sole primary feature, cleaner professional interface, other features deferred.

The interface can be specified from this evidence. Functional completion still requires independently verified account-session handling, intended-opponent identification, match transitions, outcome accounting, interruption handling, and stopping at the requested limit. A simulated dashboard alone would not satisfy the goal.

For a fresh implementation, local account/session handling and an explicit list of dependencies would address the user's request for transparent behavior. Cloud credential storage, licensing infrastructure, bulk token extraction, and a bundled VPN are observed reference features, not automatically requirements for the new program.
