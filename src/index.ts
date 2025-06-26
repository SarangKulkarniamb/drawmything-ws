// Existing imports and setup...
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { prisma } from './db/prisma';
import { Player, Room as LiveRoom } from './types';

dotenv.config();

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map<string, LiveRoom>();

console.log(`🧠 WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', async (ws, req) => {
  const params = new URLSearchParams(req.url?.split('?')[1]);
  const token = params.get('token');
  if (!token) return ws.close(4001, 'No token');

  let user: any;
  try {
    user = jwt.verify(token, process.env.WS_SECRET!);
    (ws as any).user = user;
  } catch {
    return ws.close(4002, 'Invalid token');
  }

  const player: Player = {
    id: user.id,
    name: user.name,
    avatar: user.image,
    socket: ws
  };

  ws.on('message', async (msg) => {
    try {
      const { type, data } = JSON.parse(msg.toString());

      switch (type) {
        case 'join_room': {
          const roomId = data.roomId;

          const roomFromDb = await prisma.room.findUnique({
            where: { id: roomId },
            include: { players: { include: { user: true } } }
          });

          if (!roomFromDb || roomFromDb.gameState !== 'WAITING' || roomFromDb.players.length >= 8) {
            return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Invalid or started room' } }));
          }

          if (!rooms.has(roomId)) {
            rooms.set(roomId, {
              id: roomId,
              hostId: roomFromDb.hostId,
              players: [],
              gameState: 'waiting',
              currentRound: 0,
              turns: [],
              roundData: new Map(),
              createdAt: new Date(roomFromDb.createdAt),
              passMap: new Map()
            });
          }

          const room = rooms.get(roomId)!;

          if (room.players.find(p => p.id === player.id)) {
            return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Already in room' } }));
          }

          room.players.push(player);
          ws.send(JSON.stringify({ type: 'joined_room', data: { roomId, playerId: player.id } }));
          broadcastPlayerList(room);
          break;
        }

        case 'leave_room': {
          const roomId = data.roomId;
          const room = rooms.get(roomId);
          if (!room) return;

          room.players = room.players.filter(p => p.id !== player.id);
          if (room.players.length === 0) rooms.delete(roomId);
          else broadcastPlayerList(room);

          ws.send(JSON.stringify({ type: 'left_room', data: { roomId } }));
          break;
        }

        case 'start_game': {
          const roomId = data.roomId;
          const room = rooms.get(roomId);

          if (!room) return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Room not found' } }));
          if (room.hostId !== player.id) return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Only host can start the game' } }));
          if (room.players.length < 2) return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Not enough players' } }));

          room.gameState = 'prompt';
          room.currentRound = 1;
          room.turns = [];
          room.roundData.clear();
          room.passMap = generatePassMap(room.players.map(p => p.id));

          broadcastToRoom(room, {
            type: 'game_phase',
            data: { phase: 'prompt', round: room.currentRound }
          });
          break;
        }

        case 'submission': {
          const { roomId , content } = data;
          const room = rooms.get(roomId);
          if (!room) {
            return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Room not found' } }));
          }

          const playerInRoom = room.players.find(p => p.id === player.id);
          if (!playerInRoom) {
            return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Player not in this room' } }));
          }

          
          room.roundData.set(player.id, {
            type: room.gameState,
            content,
            playerId: player.id
          });

          if (room.roundData.size === room.players.length) {
            for (const [fromId, roundEntry] of room.roundData.entries()) {
              const toId = room.passMap!.get(fromId)!;

              const turn = {
                type: room.gameState,
                from: fromId,
                to: toId,
                content: roundEntry.content
              };

              room.turns.push(turn);

              const target = room.players.find(p => p.id === toId);
              if (target?.socket.readyState === 1) {
                target.socket.send(JSON.stringify({
                  type: 'game_content',
                  data: { ...turn }
                }));
              }
            }

            room.roundData.clear();
            room.currentRound += 1;

            const nextPhase: LiveRoom["gameState"] =
              room.gameState === 'prompt' ? 'draw'
              : room.gameState === 'draw' ? 'guess'
              : room.gameState === 'guess' ? 'draw'
              : 'finished';

            if (nextPhase === 'finished' || room.currentRound > room.players.length) {
              room.gameState = 'finished';
              broadcastToRoom(room, {
                type: 'game_phase',
                data: { phase: 'finished' }
              });
            } else {
              room.gameState = nextPhase;
              broadcastToRoom(room, {
                type: 'game_phase',
                data: { phase: nextPhase, round: room.currentRound }
              });
            }

            console.log("🌀 Current Room State:\n", JSON.stringify(room, null, 2));
          }

          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'error', data: { msg: 'Unknown message type' } }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', data: { msg: 'Invalid message format' } }));
    }
  });

  ws.on('close', () => {
    const currentUser = (ws as any).user;
    for (const [roomId, room] of rooms.entries()) {
      room.players = room.players.filter(p => p.id !== currentUser.id);
      broadcastPlayerList(room);
    }
  });
});

// Helper Functions
function broadcastPlayerList(room: LiveRoom) {
  const playerList = room.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar
  }));

  for (const p of room.players) {
    if (p.socket.readyState === 1) {
      p.socket.send(JSON.stringify({
        type: 'player_list',
        data: playerList,
        hostId: room.hostId
      }));
    }
  }
}

function broadcastToRoom(room: LiveRoom, message: any) {
  for (const p of room.players) {
    if (p.socket.readyState === 1) {
      p.socket.send(JSON.stringify(message));
    }
  }
}

function generatePassMap(playerIds: string[]): Map<string, string> {
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const map = new Map<string, string>();
  for (let i = 0; i < shuffled.length; i++) {
    map.set(shuffled[i], shuffled[(i + 1) % shuffled.length]);
  }
  return map;
}
