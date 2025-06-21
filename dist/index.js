"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
dotenv_1.default.config();
const PORT = Number(process.env.PORT || 3001);
const wss = new ws_1.WebSocketServer({ port: PORT });
const rooms = new Map();
wss.on('connection', (ws, req) => {
    var _a;
    const params = new URLSearchParams((_a = req.url) === null || _a === void 0 ? void 0 : _a.split('?')[1]);
    const token = params.get("token");
    if (!token) {
        ws.close(4001, "Unauthorized: No token");
        return;
    }
    let user;
    try {
        user = jsonwebtoken_1.default.verify(token, process.env.WS_SECRET);
        ws.user = user;
        console.log("✅ Authenticated user:", user);
    }
    catch (err) {
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
            const currentUser = ws.user;
            const player = {
                id: currentUser.id,
                name: currentUser.name,
                avatar: currentUser.image,
                socket: ws
            };
            console.log(player, "player");
            switch (type) {
                case 'create_room': {
                    const roomId = crypto_1.default.randomUUID();
                    const newRoom = {
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
        }
        catch (err) {
            console.error('Invalid message format:', data.toString());
            ws.send(JSON.stringify({ type: 'error', data: { msg: 'Invalid message format' } }));
        }
    });
});
console.log(`✅ WebSocket server is running on ws://localhost:${PORT}`);
