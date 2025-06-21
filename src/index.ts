import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Player, Room } from './types';

dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map<string, Room>();

wss.on('connection', (ws, req) => {
  
  const params = new URLSearchParams(req.url?.split('?')[1]);
  const token = params.get("token");

  if (!token) {
    ws.close(4001, "Unauthorized: No token");
    return;
  }

  let user: any;
  try {
    user = jwt.verify(token, process.env.WS_SECRET!); 
    (ws as any).user = user;
    console.log("✅ Authenticated user:", user);
  } catch (err) {
    ws.close(4002, "Unauthorized: Invalid token");
    return;
  }

  ws.send(JSON.stringify({ type: "system", data: { msg: "Welcome to the WebSocket server!" } }));

  ws.on('error', console.error);

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      const { type, data: payload } = parsed;

      ws.send(JSON.stringify({ type: "system", data: { msg: `Received ${type} message` } }));

      const currentUser = (ws as any).user;
      const player: Player = {
        id: currentUser.id,
        name: currentUser.name,
        avatar: currentUser.image,
        socket: ws
      };
      console.log(player, "player");
      switch (type) {
        case 'create_room': {
          const roomId = crypto.randomUUID();

          const newRoom: Room = {
            id: roomId,
            players: [player],
            hostId: player.id,
            gameState: 'waiting',
            currentRound: 0,
            turns: [],
            roundData: new Map(),
            createdAt: new Date(),
          };

          rooms.set(roomId, newRoom);

          ws.send(JSON.stringify({ type: 'room_created', data: { roomId, playerId: player.id } }));
          
          break;
        }

        case 'join_room': {
          const { roomId } = payload;

          const room = rooms.get(roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', data: { msg: 'Room not found' } }));
            break;
          }

          room.players.push(player);

          ws.send(JSON.stringify({ type: 'joined_room', data: { roomId, playerId: player.id } }));

          room.players.forEach(p => {
            if (p.socket !== ws && p.socket.readyState === 1) {
              p.socket.send(JSON.stringify({
                type: 'player_joined',
                data: { id: player.id, name: player.name, avatar: player.avatar },
              }));
            }
          });
          console.log(rooms);
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'error', data: { msg: 'Unknown message type' } }));
          break;
      }
    } catch (err) {
      console.error('Invalid message format:', data.toString());
      ws.send(JSON.stringify({ type: 'error', data: { msg: 'Invalid message format' } }));
    }
  });
});

console.log(`✅ WebSocket server is running on ws://localhost:${PORT}`);
