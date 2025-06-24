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
              createdAt: new Date(roomFromDb.createdAt)
            });
          }

          const room = rooms.get(roomId)!;

          if (room.players.find(p => p.id === player.id)) {
            return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Already in room' } }));
          }

          room.players.push(player);

          ws.send(JSON.stringify({ type: 'joined_room', data: { roomId, playerId: player.id , hostId : roomFromDb.hostId } }));

          broadcastPlayerList(room);
          break;
        }
        case 'leave_room': {
          const roomId = data.roomId;

          if (!rooms.has(roomId)) {
            return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Room not found' } }));
          }

          const room = rooms.get(roomId)!;
          room.players = room.players.filter(p => p.id !== player.id);

          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            broadcastPlayerList(room);
          }

          ws.send(JSON.stringify({ type: 'left_room', data: { roomId } }));
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

function broadcastPlayerList(room: LiveRoom) {
  const playerList = room.players.map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar
  }));

  for (const p of room.players) {
    if (p.socket.readyState === 1) {
      p.socket.send(JSON.stringify({ type: 'player_list', data: playerList , hostId: room.hostId }));
    }
  }
}
