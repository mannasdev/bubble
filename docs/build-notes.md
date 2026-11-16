# SDD ledger — plan: /Users/mannas/Library/Application Support/Claude/scratch-workspaces/fe82494d-615d-4dbc-8bea-3e9de1844839/f9982890-1d98-4f09-ad8c-847630333919/scratch-2026-11-16-3c4c22/bubble/docs/bubble-plan.md
Ruling: code lives in the session folder under bubble/ — user asleep and named no permanent folder — costs a move later; nothing is lost while the session exists.
Ruling: plan+spec copied into bubble/docs so the scripts and repo can see them — none.
Pre-flight: T1→T2 checkAccess/DENIED_HTML consistent. T1,T3→T4 State/runClaude/RunError consistent. T2,T4→T6 createProxy.handleApi matches createApi return (req,res). No conflicts.
Task 1: complete (commits edd5302..06ac410, tests: node --test → ℹ duration_ms 52.9215)
Task 2: Ruling: proxy removes the bubble_k cookie before forwarding — the project's server has no business seeing the access key — none known.
Task 2: Ruling: proxy connects to "localhost" not 127.0.0.1 and sends Host: localhost:<port> — Vite listens on ::1 only and rejects unknown hosts — a dev server that needs the public host name would see localhost instead.
Task 2: Note: test run hung because the test's fake websocket server never closed its half-open side; fixed in the test. A speculative close-handler added to proxy.js was removed again: no test could make it matter.
Task 2: complete (commits 06ac410..20485cb, tests: node --test --test-timeout=10000 → ℹ duration_ms 72.641)
Task 3: Ruling: runner settles on the stream's result line and stops the process 3s later (new lingerMs option), instead of waiting for exit — real claude v2.1.325 with stream-json stays alive after its result; first real check hit the 5-minute timeout — if 3s is too short for the conversation to be saved, a follow-up would start fresh (real check showed resume working).
Task 3: Real check passed 2026-11-17: heading edited, .env not revealed, package.json unchanged, follow-up resumed same session, bogus session id → stale-session, no leftover processes.
Task 3: complete (commits 20485cb..dc0df9a, tests: node --test --test-timeout=10000 → ℹ duration_ms 1291.988833)
Task 4: complete (commits dc0df9a..e09590e, tests: node --test --test-timeout=10000 → ℹ duration_ms 1286.514875)
Task 5: complete (commits e09590e..fac641b, tests: node --test --test-timeout=10000 → ℹ duration_ms 1271.631083)
Task 5: Ruling: bubble button is always dark with a white ring instead of following light/dark mode — in dark mode it was pale grey on a white page and nearly invisible — none.
Task 5: Ruling: the "Pointing at" label shows the element's words, not the CSS selector — she is not a programmer; Claude still receives the selector — none.
Task 6: Ruling: stand-in programs live in fakes/, not test/ — node --test runs every file under test/ and the cloudflared stand-in never exits — none.
Task 6: Ruling: parseArgs and main live in src/cli.js; bin/bubble.js only calls main — keeps the entry file importable in tests — none.
Task 6: Ruling: named tunnel is started as `cloudflared tunnel --url <local> run bubble` (flag before `run`) — --url belongs to the parent command in v2026.7.2 help — UNVERIFIED against a real Cloudflare login; if wrong, fixed-address mode fails at start with cloudflared's message.
Task 6: Ruling: system prompt gained "The page refreshes by itself… never tell her to refresh" — real run told her to refresh, which the widget already does — none.
Task 6: Step 5 end-to-end passed 2026-11-17 (curl + real claude + in-app browser): 403 without key, 302 with key, tag injected, change made and page reloaded, point mode works, .env not leaked, log written, Ctrl+C equivalent stops it. Step 6 (fixed address) NOT done: needs the user's `cloudflared tunnel login` and hostname.
Task 6: complete (commits fac641b..3f47382, tests: node --test --test-timeout=10000 → ℹ duration_ms 1305.8975)
Final review: fresh reviewer (opus). No Critical. Access gate judged sound.
Final: fixed "message starting with - read as a CLI flag" — test "her words go in on stdin…" RED→GREEN, suite 79/79; confirmed with real claude.
Final: fixed "any early failure treated as stale session" — test "a resumed run that fails early for another reason is failed, not stale" RED→GREEN, suite 79/79.
Final: fixed "12-hour idle reset never happens" — test "a conversation idle for more than 12 hours starts fresh" RED→GREEN, suite 79/79.
Final: fixed "deny rules only cover project root" — test "settings deny secrets and config files" RED→GREEN, suite 79/79; real claude refused nested .env.local and nested package.json.
Final: fixed (re-graded from ruling note to Important) "redirects to localhost:<port> send visitors to their own machine" — test "redirects that point at the dev server itself are made relative" RED→GREEN, suite 79/79.
Final: Ruling: reviewer declined to judge whether Read deny rules cover Grep — tested with real claude: search for the secret text returned nothing and the file could not be opened — stands — if a future claude version changes this, secrets could leak through search.
Final: Ruling: Secure cookie on http://localhost (Safari, --no-tunnel only) — stands, documented in README — local-only trial fails in Safari.
Final: Ruling: injection into HEAD/304/non-UTF-8 pages and key rotation — not addressed; key can be rotated by deleting .bubble/key (README) — odd pages may show no bubble.
Final: minor (deferred): open redirect via //evil.com path, only usable with the key (src/access.js).
Final: minor (deferred): no CSRF check beyond SameSite=Lax; sibling subdomains of the fixed host count as same-site (src/api.js).
Final: minor (deferred): no cap on queued messages or history size (src/api.js, src/state.js).
Final: minor (deferred): next request can start while the previous claude process is still in its 3s wind-down (src/runner.js).
Final: minor (deferred): timeout kills only the direct child; no SIGKILL escalation; stop() does not kill an in-flight run (src/runner.js, src/cli.js).
Final: minor (deferred): a disk error while saving a failure can crash bubble (src/api.js drain).
Final: minor (deferred): SSE cleanup listens on req close rather than res close (src/api.js).
