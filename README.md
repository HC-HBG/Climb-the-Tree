# Climb the Tree

A crash-format game for the HungryBear Gaming 8-Bit Bear arcade series. The
player watches a bear climb a tree as a multiplier grows, and must cash out
before the bear falls.

This is a pnpm monorepo with three packages:

- **`packages/engine`** — pure TypeScript, zero runtime dependencies. The
  provably-fair crash derivation (SHA-256 via WebCrypto), the crash formula,
  the growth curve, and integer-cents settlement math. Shared by the server
  and the client, and fully deterministic.
- **`packages/server`** — Node + TypeScript WebSocket round engine
  implementing the protocol in the FSD (§2.1). Owns seeds, the round clock,
  settlement, and an in-memory wallet stub. The crash point never leaves the
  server during a live round.
- **`packages/client`** — PixiJS v8 + TypeScript + Vite game client. Bet
  panel, live multiplier, manual/auto cash-out, crash/cash-out feedback,
  round history, and a provably-fair panel, with placeholder pixel art.

## Requirements

- Node >= 20
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)

## Running it

```bash
pnpm install
pnpm dev       # runs the server (ws://localhost:8787) and the client
               # (http://localhost:5173) together
```

Then open http://localhost:5173 and place a bet.

Other useful commands:

```bash
pnpm test        # runs every package's test suite (Vitest)
pnpm typecheck    # tsc --noEmit across every package
pnpm lint         # ESLint across the whole repo
pnpm format       # Prettier --write across the whole repo
pnpm run simulate # ad-hoc large (default 10M-round) RTP/instant-fall
                  # simulation CLI, for spot-checking beyond the automated
                  # 1M-round test (packages/engine)
```

## Demo build (no server, GitHub Pages)

`packages/client` normally talks to the live server over WebSocket
(`GameSocket`, `src/net/wsClient.ts`) — that's the real, server-authoritative
client. For a zero-backend demo that can be deployed as a static site (e.g.
GitHub Pages), there's also `LocalTransport`
(`src/net/localTransport.ts`): it runs the exact same `RoundSession`/`Wallet`
the server uses, in-process in the browser, behind the same `Transport`
interface, so `GameController` doesn't know the difference.

```bash
VITE_DEMO_MODE=true pnpm --filter @climb-the-tree/client run build
```

This is what `.github/workflows/deploy-demo.yml` builds and publishes to
GitHub Pages on every push (Settings → Pages → Source must be set to "GitHub
Actions" once for the first deploy to take effect). The demo build shows a
persistent banner explaining that outcomes are computed client-side and it
is **not** representative of real-money play — the FSD's "the crash point
never leaves the server" guarantee only holds for the real WebSocket client.
```

`pnpm dev` runs each package's own `dev` script in parallel via pnpm's
workspace filtering (`pnpm --parallel --filter "./packages/*" run dev`); the
server uses `tsx watch` and the client uses Vite's dev server, so both
hot-reload independently.

## The math model

`packages/engine/src/crash.ts` implements the crash formula from the Math
Specification:

```
U     = first 52 bits of SHA256(serverSeed:clientSeed:nonce) / 2^52
crash = trunc( min( max( RTP / U, 1.00 ), MaxMultiplier ), 2dp )
```

with RTP = 0.97 and MaxMultiplier = 1000 by default
(`packages/engine/src/config.ts`). All 8 deterministic test vectors from the
Math Specification reproduce bit-exactly
(`packages/engine/test/crash.test.ts`), and a 1M-round simulation
(`packages/engine/test/simulation.test.ts`) confirms RTP is 97% ± 0.3% at
cashout targets 1.5x / 2x / 5x / 10x and the true instant-fall rate
(`P(U >= RTP)`) is 3.0% ± 0.1%.

Note: the crash *value* is truncated to 2 decimal places (matching the Math
Spec's test vectors bit-exactly), but 2dp truncation alone would merge the
thin (1.00x, 1.01x) band into the displayed "1.00x" bucket, inflating a
naive `crash === 1.00` instant-fall count to ~3.96%. The engine tracks the
true instant-fall condition (`isInstantFall`, i.e. `U >= RTP`) as an explicit
flag separate from the displayed/settled crash number, so the statistical
guarantee and the bit-exact display value don't conflict.

The multiplier growth curve `m(t) = e^(k·t)` (k = 0.15) is presentation-only
and has zero effect on odds; the server uses its inverse
(`t = ln(m)/k`) to know when a round should crash or auto-cash-out in
wall-clock time, and the client uses it to locally predict the climb for
smooth 60fps animation between the server's 250ms `round:tick` messages —
the client never learns the true crash point until the round ends.

## WebSocket protocol (v1)

Per FSD §2.1, all money values are integer cents:

**Server → client:** `round:ready` `round:started` `round:tick`
`round:crashed` `cashout:confirmed` `error`

**Client → server:** `bet:place` `cashout` `seed:setClient` `seed:rotate`

See `packages/engine/src/protocol.ts` for the exact message shapes.

## Client scene layers

`packages/client/src/game/Scene.ts` renders the climb as explicit Pixi
`Container` layers, added back-to-front exactly once at init and never
drawn across:

```
skyLayer -> celestialLayer (moonLayer, starsLayer) -> farMountains
  -> nearMountains -> pineSilhouettes -> groundLayer
  -> treeLayer (trunk + milestone branches) -> bearLayer -> fxLayer
```

`uiLayer` (ladder rail + marker) is a sibling of every layer above, not a
child — it and `skyLayer` never scroll. Every other layer scrolls per
frame via one shared `cameraY = heightOf(multiplier) * SCROLL_PX` value
and its own constant factor (`SCROLL_FACTOR` in Scene.ts): stars 0.15,
moon 0.08, far mountains 0.25, near mountains 0.4, pines 0.55, ground and
tree 1.0 (world-locked, full speed). The bear is screen-fixed (`bearLayer`
ignores the camera entirely) — the world scrolls under it, never the
other way around. Crash screen-shake is applied to a `shakeRoot` wrapper
that holds everything except `uiLayer`, so the ladder/HUD never jitters.

**Visual regression check** (manual, until this has automated coverage):
at 1x, the tree trunk must fully occlude the mountains/pines directly
behind it (not the reverse), with the bear sitting on top of the trunk.
Climbing to ~10x, the mountains should drift down slowly, the pines a
bit faster, and the tree/branches at full scroll speed, while the ladder
rail and its marker never shift position on screen.

## Status

Milestone 1: monorepo scaffold, engine with full math-spec test coverage,
server round engine with FSD §3 state-machine and edge-case integration
tests (E-02, E-03, E-04, E-06, E-07), and a playable client (bet → climb →
manual/auto cash-out → crash → history) with placeholder art. Final pixel
art, audio, the full provably-fair verifier UI, and WebSocket-reconnect
handling (E-01) are follow-up work.
