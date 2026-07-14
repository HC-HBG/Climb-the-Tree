import { createHash } from "node:crypto";
import { crashFromUniform, crashMessage, isInstantFall, uniformFromHash } from "../src/crash.js";

/**
 * Ad-hoc CLI runner for larger simulations than the automated 1M-round test,
 * matching Math Specification §QA Tests ("RTP convergence", ≥10M rounds).
 * Not part of `pnpm test`; run explicitly via `pnpm run simulate`.
 */
const ROUNDS = Number(process.argv[2] ?? 10_000_000);
const TARGETS = [1.5, 2, 5, 10, 50];
const SERVER_SEED = "manual-simulation-server-seed";
const CLIENT_SEED = "manual-simulation-client-seed";

console.log(`Simulating ${ROUNDS.toLocaleString()} rounds...`);
const t0 = Date.now();

let instantFalls = 0;
const hitsByTarget = new Map(TARGETS.map((t) => [t, 0]));

for (let nonce = 0; nonce < ROUNDS; nonce++) {
  const hash = createHash("sha256")
    .update(crashMessage(SERVER_SEED, CLIENT_SEED, nonce))
    .digest("hex");
  const u = uniformFromHash(hash);
  const crash = crashFromUniform(u);
  if (isInstantFall(u)) instantFalls++;
  for (const target of TARGETS) {
    if (crash >= target) hitsByTarget.set(target, (hitsByTarget.get(target) ?? 0) + 1);
  }
}

const dt = Date.now() - t0;
console.log(`Done in ${(dt / 1000).toFixed(1)}s\n`);
console.log(`Instant-fall rate: ${((instantFalls / ROUNDS) * 100).toFixed(4)}% (target 3.0000%)`);
console.log();
console.log("target   hit rate    RTP");
for (const target of TARGETS) {
  const hits = hitsByTarget.get(target) ?? 0;
  const hitRate = hits / ROUNDS;
  const rtp = target * hitRate;
  console.log(
    `${target.toString().padEnd(8)} ${(hitRate * 100).toFixed(4).padStart(8)}%   ${(rtp * 100).toFixed(4)}%`,
  );
}
