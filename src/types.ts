import type { WebSocket } from 'ws';

export type Player = {
  id: string;
  name: string;
  avatar: string;
  socket: WebSocket;
};

export type GameTurn = {
  type: "prompt" | "drawing" | "guess";
  from: string;              // userId
  to: string;                
  content: string;           // output (guess or drawing)
};

export type Room = {
  id: string;
  players: Player[];
  hostId: string;
  gameState: "waiting" | "in-progress" | "finished";
  currentRound: number;
  turns: GameTurn[];         // full game history
  roundData: Map<string, any>; // current round state per player
  createdAt: Date;
};
