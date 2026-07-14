import type { ClientToServerMessage } from "@climb-the-tree/engine";

/**
 * Narrow, defensive parsing of inbound WebSocket frames. Never trust the
 * wire: malformed or unexpected payloads become `undefined` rather than
 * throwing, so a bad frame degrades to an `error` reply instead of
 * crashing the connection.
 */
export function parseClientMessage(raw: string): ClientToServerMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null || !("type" in json)) return undefined;
  const msg = json as { type: unknown };

  switch (msg.type) {
    case "bet:place": {
      const m = json as { amount?: unknown; autoX?: unknown };
      if (typeof m.amount !== "number") return undefined;
      if (m.autoX !== undefined && typeof m.autoX !== "number") return undefined;
      return { type: "bet:place", amount: m.amount, autoX: m.autoX };
    }
    case "cashout": {
      const m = json as { clientTs?: unknown };
      if (typeof m.clientTs !== "number") return undefined;
      return { type: "cashout", clientTs: m.clientTs };
    }
    case "seed:setClient": {
      const m = json as { seed?: unknown };
      if (typeof m.seed !== "string") return undefined;
      return { type: "seed:setClient", seed: m.seed };
    }
    case "seed:rotate":
      return { type: "seed:rotate" };
    default:
      return undefined;
  }
}
