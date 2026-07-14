/**
 * WebSocket protocol (v1), per FSD §2.1. Shared between server and client so
 * both sides compile against the same message shapes. All money values are
 * integer cents.
 */

export interface RoundReadyMsg {
  type: "round:ready";
  seedHash: string;
  nonce: number;
}

export interface RoundStartedMsg {
  type: "round:started";
  startTs: number;
}

export interface RoundTickMsg {
  type: "round:tick";
  serverTime: number;
}

export interface RoundCrashedMsg {
  type: "round:crashed";
  crash: number;
  serverSeed?: string;
}

export interface CashoutConfirmedMsg {
  type: "cashout:confirmed";
  x: number;
  win: number;
  balance: number;
}

export type ErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "INVALID_BET"
  | "NO_ACTIVE_ROUND"
  | "ROUND_IN_PROGRESS"
  | "ALREADY_SETTLED"
  | "AFTER_CRASH"
  | "RATE_LIMITED";

export interface ErrorMsg {
  type: "error";
  code: ErrorCode;
  msg: string;
}

export type ServerToClientMessage =
  | RoundReadyMsg
  | RoundStartedMsg
  | RoundTickMsg
  | RoundCrashedMsg
  | CashoutConfirmedMsg
  | ErrorMsg;

export interface BetPlaceMsg {
  type: "bet:place";
  amount: number;
  autoX?: number;
}

export interface CashoutMsg {
  type: "cashout";
  clientTs: number;
}

export interface SeedSetClientMsg {
  type: "seed:setClient";
  seed: string;
}

export interface SeedRotateMsg {
  type: "seed:rotate";
}

export type ClientToServerMessage = BetPlaceMsg | CashoutMsg | SeedSetClientMsg | SeedRotateMsg;
