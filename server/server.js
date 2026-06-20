import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chooseBotCard,
  createGame,
  createNextRound,
  finishCollecting,
  isRevealCandidate,
  legalCards,
  playCard,
  startPlaying,
  startRevealPhase,
  toggleRevealCard,
} from "../src/game.js";

const root = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const rooms = new Map();
const botPlayDelay = 425;
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

function makeId(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < length; i += 1) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function makeRoomId() {
  let id = makeId();
  while (rooms.has(id)) id = makeId();
  return id;
}

function makeClientId() {
  return `${Date.now().toString(36)}-${makeId(8)}`;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function roomError(res, status, message) {
  json(res, status, { error: message });
}

function playerIndex(room, clientId) {
  return room.seats.findIndex((seat) => seat?.clientId === clientId);
}

function renameGamePlayers(game, room) {
  return {
    ...game,
    players: game.players.map((player, index) => ({
      ...player,
      name: room.seats[index]?.name || player.name,
    })),
  };
}

function createRoom(name) {
  const room = {
    id: makeRoomId(),
    seats: Array.from({ length: 4 }, () => null),
    game: null,
    ready: new Set(),
    dealUntil: 0,
    collectUntil: 0,
    nextRoundAt: 0,
    botActionAt: 0,
    updatedAt: Date.now(),
  };
  const clientId = makeClientId();
  room.seats[0] = { clientId, name: name || "玩家1" };
  rooms.set(room.id, room);
  return { room, clientId };
}

function joinRoom(room, name, existingClientId) {
  const existing = existingClientId ? playerIndex(room, existingClientId) : -1;
  if (existing >= 0) return existingClientId;

  const index = room.seats.findIndex((seat) => !seat);
  if (index < 0) return null;
  const clientId = makeClientId();
  room.seats[index] = { clientId, name: name || `玩家${index + 1}` };
  room.updatedAt = Date.now();
  return clientId;
}

function addBot(room) {
  const index = room.seats.findIndex((seat) => !seat);
  if (index < 0) return false;
  room.seats[index] = { clientId: `bot-${room.id}-${index}`, name: `人机${index + 1}`, bot: true };
  room.updatedAt = Date.now();
  return true;
}

function normalizeRoom(room) {
  if (!room.game) return;
  const now = Date.now();

  if (room.game.phase === "dealing" && room.dealUntil && now >= room.dealUntil) {
    room.game = startRevealPhase(room.game);
    room.ready.clear();
    room.dealUntil = 0;
    room.botActionAt = 0;
  }

  if (room.game.phase === "collecting" && room.collectUntil && now >= room.collectUntil) {
    room.game = finishCollecting(room.game);
    room.collectUntil = 0;
    room.botActionAt = 0;
    if (room.game.phase === "roundFinished") room.nextRoundAt = now + 1200;
  }

  if (room.game.phase === "roundFinished" && room.nextRoundAt && now >= room.nextRoundAt) {
    room.game = renameGamePlayers(startRevealPhase(createNextRound(room.game)), room);
    room.ready.clear();
    room.nextRoundAt = 0;
    room.botActionAt = 0;
  }

  if (room.game.phase === "reveal") {
    for (const seat of room.seats) {
      if (seat?.bot) room.ready.add(seat.clientId);
    }
    if (room.ready.size === room.seats.filter(Boolean).length) {
      room.game = startPlaying(room.game);
      room.ready.clear();
      room.botActionAt = 0;
    }
  }

  let guard = 0;
  while (room.game?.phase === "playing" && guard < 8) {
    const currentSeat = room.seats[room.game.currentPlayer];
    if (!currentSeat?.bot) break;
    const player = room.game.players[room.game.currentPlayer];
    if (room.game.thinkingPlayer !== player.id) {
      room.game = { ...room.game, thinkingPlayer: player.id, message: `${player.name} 正在思考...` };
      room.botActionAt = now + botPlayDelay;
      break;
    }
    if (!room.botActionAt) room.botActionAt = now + botPlayDelay;
    if (now < room.botActionAt) break;
    const cards = legalCards(room.game, room.game.currentPlayer);
    const card = chooseBotCard(room.game, cards);
    room.game = playCard(room.game, room.game.currentPlayer, card.id);
    room.botActionAt = 0;
    if (room.game.phase === "collecting") {
      room.collectUntil = Date.now() + 1050;
      break;
    }
    guard += 1;
  }
}

function publicGame(room, clientId) {
  normalizeRoom(room);
  const you = playerIndex(room, clientId);
  const game = room.game;
  const legalCardIds = game && you >= 0 && game.phase === "playing" ? legalCards(game, you).map((card) => card.id) : [];

  return {
    roomId: room.id,
    seats: room.seats.map((seat, index) => ({
      index,
      name: seat?.name || "",
      occupied: Boolean(seat),
      bot: Boolean(seat?.bot),
      you: seat?.clientId === clientId,
      ready: room.ready.has(seat?.clientId),
    })),
    you,
    readyCount: room.ready.size,
    game: game
      ? {
          ...game,
          players: game.players.map((player, index) => ({
            ...player,
            hand: index === you ? player.hand : Array.from({ length: player.hand.length }, (_, cardIndex) => ({ id: `hidden-${index}-${cardIndex}` })),
          })),
        }
      : null,
    legalCardIds,
  };
}

function startRoomGame(room) {
  if (room.seats.some((seat) => !seat)) return false;
  room.game = renameGamePlayers(createGame(), room);
  room.ready.clear();
  room.dealUntil = Date.now() + 625;
  room.botActionAt = 0;
  room.updatedAt = Date.now();
  return true;
}

function handleAction(room, clientId, action) {
  normalizeRoom(room);
  const index = playerIndex(room, clientId);
  if (index < 0) return "你不在这个房间中";

  if (action.type === "startGame") {
    if (room.game && !room.game.gameOver) return "游戏已经开始";
    return startRoomGame(room) ? "" : "需要 4 名玩家入座";
  }

  if (action.type === "addBot") {
    if (room.game && !room.game.gameOver) return "游戏已经开始，不能补人机";
    return addBot(room) ? "" : "房间已满";
  }

  if (!room.game) return "游戏尚未开始";

  if (action.type === "toggleReveal") {
    const card = room.game.players[index].hand.find((item) => item.id === action.cardId);
    if (!card || !isRevealCandidate(card)) return "这张牌不能亮";
    room.game = toggleRevealCard(room.game, index, action.cardId);
    return "";
  }

  if (action.type === "ready") {
    if (room.game.phase !== "reveal") return "当前不能准备";
    room.ready.add(clientId);
    if (room.ready.size === room.seats.filter(Boolean).length) {
      room.game = startPlaying(room.game);
      room.ready.clear();
      room.botActionAt = 0;
    }
    return "";
  }

  if (action.type === "playCard") {
    const before = room.game;
    room.game = playCard(room.game, index, action.cardId);
    if (room.game === before) return "当前不能出这张牌";
    room.botActionAt = 0;
    if (room.game.phase === "collecting") room.collectUntil = Date.now() + 1050;
    return "";
  }

  return "未知操作";
}

async function serveStatic(req, res, pathname) {
  const filePath = normalize(join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === "POST" && pathname === "/api/rooms") {
      const body = await bodyJson(req);
      const { room, clientId } = createRoom(body.name);
      json(res, 200, { roomId: room.id, clientId, state: publicGame(room, clientId) });
      return;
    }

    const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (req.method === "POST" && joinMatch) {
      const room = rooms.get(joinMatch[1].toUpperCase());
      if (!room) return roomError(res, 404, "房间不存在");
      const body = await bodyJson(req);
      const clientId = joinRoom(room, body.name, body.clientId);
      if (!clientId) return roomError(res, 409, "房间已满");
      json(res, 200, { roomId: room.id, clientId, state: publicGame(room, clientId) });
      return;
    }

    const stateMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (req.method === "GET" && stateMatch) {
      const room = rooms.get(stateMatch[1].toUpperCase());
      if (!room) return roomError(res, 404, "房间不存在");
      json(res, 200, { state: publicGame(room, url.searchParams.get("clientId")) });
      return;
    }

    const actionMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/action$/);
    if (req.method === "POST" && actionMatch) {
      const room = rooms.get(actionMatch[1].toUpperCase());
      if (!room) return roomError(res, 404, "房间不存在");
      const body = await bodyJson(req);
      const error = handleAction(room, body.clientId, body);
      room.updatedAt = Date.now();
      json(res, error ? 400 : 200, { error, state: publicGame(room, body.clientId) });
      return;
    }

    const leaveMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
    if (req.method === "POST" && leaveMatch) {
      const room = rooms.get(leaveMatch[1].toUpperCase());
      if (!room) return roomError(res, 404, "房间不存在");
      const body = await bodyJson(req);
      const index = playerIndex(room, body.clientId);
      if (index >= 0) room.seats[index] = null;
      if (room.seats.every((seat) => !seat || seat.bot)) rooms.delete(room.id);
      json(res, 200, { ok: true });
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "服务器错误" });
  }
});

const port = Number(process.env.PORT || 5173);
server.listen(port, "0.0.0.0", () => {
  console.log(`Gongzhu server running at http://127.0.0.1:${port}`);
});
