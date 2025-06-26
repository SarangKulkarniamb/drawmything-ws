"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Existing imports and setup...
const ws_1 = require("ws");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = require("./db/prisma");
dotenv_1.default.config();
const PORT = 3001;
const wss = new ws_1.WebSocketServer({ port: PORT });
const rooms = new Map();
console.log(`🧠 WebSocket server running on ws://localhost:${PORT}`);
wss.on('connection', (ws, req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const params = new URLSearchParams((_a = req.url) === null || _a === void 0 ? void 0 : _a.split('?')[1]);
    const token = params.get('token');
    if (!token)
        return ws.close(4001, 'No token');
    let user;
    try {
        user = jsonwebtoken_1.default.verify(token, process.env.WS_SECRET);
        ws.user = user;
    }
    catch (_b) {
        return ws.close(4002, 'Invalid token');
    }
    const player = {
        id: user.id,
        name: user.name,
        avatar: user.image,
        socket: ws
    };
    ws.on('message', (msg) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { type, data } = JSON.parse(msg.toString());
            switch (type) {
                case 'join_room': {
                    const roomId = data.roomId;
                    const roomFromDb = yield prisma_1.prisma.room.findUnique({
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
                    const room = rooms.get(roomId);
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
                    if (!room)
                        return;
                    room.players = room.players.filter(p => p.id !== player.id);
                    if (room.players.length === 0)
                        rooms.delete(roomId);
                    else
                        broadcastPlayerList(room);
                    ws.send(JSON.stringify({ type: 'left_room', data: { roomId } }));
                    break;
                }
                case 'start_game': {
                    const roomId = data.roomId;
                    const room = rooms.get(roomId);
                    if (!room)
                        return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Room not found' } }));
                    if (room.hostId !== player.id)
                        return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Only host can start the game' } }));
                    if (room.players.length < 2)
                        return ws.send(JSON.stringify({ type: 'error', data: { msg: 'Not enough players' } }));
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
                    const { roomId, content } = data;
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
                    // Wait for all submissions
                    if (room.roundData.size === room.players.length) {
                        for (const [fromId, roundEntry] of room.roundData.entries()) {
                            const toId = room.passMap.get(fromId);
                            const turn = {
                                type: room.gameState,
                                from: fromId,
                                to: toId,
                                content: roundEntry.content
                            };
                            room.turns.push(turn);
                            // Send this turn to the correct player privately
                            const target = room.players.find(p => p.id === toId);
                            if ((target === null || target === void 0 ? void 0 : target.socket.readyState) === 1) {
                                target.socket.send(JSON.stringify({
                                    type: 'game_content',
                                    data: Object.assign({}, turn)
                                }));
                            }
                        }
                        // Prepare for next phase
                        room.roundData.clear();
                        room.currentRound += 1;
                        const nextPhase = room.gameState === 'prompt' ? 'draw'
                            : room.gameState === 'draw' ? 'guess'
                                : room.gameState === 'guess' ? 'draw'
                                    : 'finished';
                        if (nextPhase === 'finished' || room.currentRound > room.players.length) {
                            room.gameState = 'finished';
                            broadcastToRoom(room, {
                                type: 'game_phase',
                                data: { phase: 'finished' }
                            });
                        }
                        else {
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
        }
        catch (err) {
            ws.send(JSON.stringify({ type: 'error', data: { msg: 'Invalid message format' } }));
        }
    }));
    ws.on('close', () => {
        const currentUser = ws.user;
        for (const [roomId, room] of rooms.entries()) {
            room.players = room.players.filter(p => p.id !== currentUser.id);
            broadcastPlayerList(room);
        }
    });
}));
// Helper Functions
function broadcastPlayerList(room) {
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
function broadcastToRoom(room, message) {
    for (const p of room.players) {
        if (p.socket.readyState === 1) {
            p.socket.send(JSON.stringify(message));
        }
    }
}
function generatePassMap(playerIds) {
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
    const map = new Map();
    for (let i = 0; i < shuffled.length; i++) {
        map.set(shuffled[i], shuffled[(i + 1) % shuffled.length]);
    }
    return map;
}
