import type { WebSocket } from 'ws';

export type GamePhase = "waiting" | "prompt" | "guess" | "draw" | "finished";

export type Player = {
  id: string;
  name: string;
  avatar: string;
  socket: WebSocket;
};

export type GameTurn = {
  type: "waiting" | "prompt" | "guess" | "draw" | "finished";
  from: string;
  to: string;
  content: string;
};

export type RoundData = {
  type: "waiting" | "prompt" | "guess" | "draw" | "finished";
  content: string;
  playerId: string;
};

export type Room = {
  id: string;
  players: Player[];
  hostId: string;
  gameState: GamePhase;
  currentRound: number;
  turns: GameTurn[];
  roundData: Map<string, RoundData>;
  passMap?: Map<string, string>;
  createdAt: Date;
};
