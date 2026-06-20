import { isBuffCard, isLockedRevealedCard, isRevealCandidate, isRevealed, suitLabel, suitName } from "./game.js";

const root = document.querySelector("#root");
const storageKey = "gongzhu-online-session";
let session = JSON.parse(localStorage.getItem(storageKey) || "{}");
let state = null;
let errorMessage = "";
let pollTimer = 0;
let animatedPlayKey = "";
let scoreHelpOpen = false;
let rulesOpen = false;

function saveSession() {
  localStorage.setItem(storageKey, JSON.stringify(session));
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw Object.assign(new Error("网络连接不稳定，请稍后重试"), { status: 0 });
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || data.error) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function specialLabel(card) {
  if (card.suit === "spades" && card.rank === "Q") return "猪";
  if (card.suit === "diamonds" && card.rank === "J") return "羊";
  if (card.suit === "clubs" && card.rank === "10") return "变";
  return "";
}

function cardButton(card, options = {}) {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  const label = specialLabel(card);
  const button = document.createElement("button");
  button.className = `card ${red ? "red" : "black"} ${label ? "specialCard" : ""} ${options.revealed ? "revealedCard" : ""} ${options.collected ? "collectedRevealCard" : ""} ${options.locked ? "lockedCard" : ""}`;
  button.disabled = Boolean(options.disabled);
  button.innerHTML = `${label ? `<i>${label}</i>` : ""}<span>${card.rank}</span><strong>${suitLabel[card.suit]}</strong><small>${options.collected ? "已收回 x2" : options.revealed ? "亮 x2" : suitName[card.suit]}</small>`;
  if (options.onClick) button.addEventListener("click", options.onClick);
  return button;
}

function cardLabelFromId(cardId) {
  const [suit, rank] = cardId.split("-");
  return `${suitLabel[suit] ?? ""}${rank ?? ""}`;
}

function pilePreview(cards, game, limit = 7) {
  if (cards.length === 0) return '<span class="emptyPile">空</span>';
  return cards
    .slice(-limit)
    .map((card) => {
      const revealed = isRevealed(game, card.id);
      const label = specialLabel(card);
      return `<span class="miniCard ${card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black"} ${label ? "specialMini" : ""} ${revealed ? "revealedMini" : ""}">${label ? `<i>${label}</i>` : ""}${suitLabel[card.suit]}${card.rank}${revealed ? "×2" : ""}</span>`;
    })
    .join("");
}

function isCollectedRevealedCard(game, card) {
  return isRevealed(game, card.id) && game.suitOpened.includes(card.suit);
}

function opponent(player, position, game) {
  const section = document.createElement("section");
  const thinking = game.thinkingPlayer === player.id ? " thinking" : "";
  section.className = `opponent ${position}${thinking}`;
  section.innerHTML = `
    <div>
      <strong>${player.name} <b>${player.totalScore}</b></strong>
      <span>${game.thinkingPlayer === player.id ? "思考中..." : `${player.hand.length} 张 · 本轮 ${player.roundScore}`}</span>
    </div>
  `;
  return section;
}

function seatList() {
  return `
    <div class="onlineSeats">
      ${state.seats
        .map(
          (seat) => `
            <div class="seat ${seat.you ? "youSeat" : ""}">
              <strong>${seat.occupied ? seat.name : "空位"}</strong>
              <span>${seat.you ? (seat.ready ? "你 · 已完成亮牌" : "你") : seat.bot ? "人机" : seat.ready ? "已完成亮牌" : seat.occupied ? "已入座" : "等待加入"}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function helpModals() {
  return `
    ${
      scoreHelpOpen
        ? `<div class="modalBackdrop" data-action="close-score-help">
            <section class="scoreHelp" role="dialog" aria-modal="true">
              <div>
                <h2>牌分</h2>
                <button type="button" class="ghostButton" data-action="close-score-help">关闭</button>
              </div>
              <ul class="ruleList">
                <li>红桃 A：-50</li>
                <li>红桃 K：-40</li>
                <li>红桃 Q：-30</li>
                <li>红桃 J：-20</li>
                <li>红桃 2/3/4/5：0</li>
                <li>其他红桃：每张 -10</li>
                <li>收齐 13 张红桃：+200</li>
                <li>黑桃 Q：-200</li>
                <li>方块 J：+100</li>
                <li>梅花 10：本家得分翻倍</li>
                <li>亮牌：对应效果再翻倍</li>
                <li>累计分到 -1600 的玩家判负</li>
              </ul>
            </section>
          </div>`
        : ""
    }
    ${
      rulesOpen
        ? `<div class="modalBackdrop" data-action="close-rules">
            <section class="scoreHelp" role="dialog" aria-modal="true">
              <div>
                <h2>规则简介</h2>
                <button type="button" class="ghostButton" data-action="close-rules">关闭</button>
              </div>
              <ul class="ruleList">
                <li>每轮四人各 13 张，摸到梅花 2 的玩家先出。</li>
                <li>按逆时针出牌，必须跟首牌花色；没有该花色时可垫任意牌。</li>
                <li>同花色最大牌赢得本墩，并获得下一墩先手。</li>
                <li>红桃、黑桃 Q、方块 J、梅花 10 会进入赢家计分牌堆，普通牌进入弃牌堆。</li>
                <li>每轮开始前可亮黑桃 Q、方块 J、梅花 10 或红桃 A；亮牌效果翻倍，且该花色第一次出现并收墩后才可打出。</li>
                <li>每轮结束自动累计分数，累计到 -1600 的玩家输掉本游戏。</li>
              </ul>
            </section>
          </div>`
        : ""
    }
  `;
}

function bindHelpEvents() {
  root.querySelector('[data-action="rules"]')?.addEventListener("click", () => {
    rulesOpen = true;
    render();
  });

  root.querySelector('[data-action="score-help"]')?.addEventListener("click", () => {
    scoreHelpOpen = true;
    render();
  });

  root.querySelectorAll('[data-action="close-score-help"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.target !== event.currentTarget && event.currentTarget.classList.contains("modalBackdrop")) return;
      scoreHelpOpen = false;
      render();
    });
  });

  root.querySelectorAll('[data-action="close-rules"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.target !== event.currentTarget && event.currentTarget.classList.contains("modalBackdrop")) return;
      rulesOpen = false;
      render();
    });
  });
}

function resetSession(message = "") {
  window.clearTimeout(pollTimer);
  session = {};
  state = null;
  errorMessage = message;
  localStorage.removeItem(storageKey);
  animatedPlayKey = "";
}

async function createRoom(name) {
  const data = await api("/api/rooms", { method: "POST", body: JSON.stringify({ name }) });
  session = { roomId: data.roomId, clientId: data.clientId, name };
  saveSession();
  state = data.state;
  errorMessage = "";
  animatedPlayKey = "";
  render();
}

async function joinRoom(roomId, name) {
  const data = await api(`/api/rooms/${roomId.toUpperCase()}/join`, {
    method: "POST",
    body: JSON.stringify({ name, clientId: session.clientId }),
  });
  session = { roomId: data.roomId, clientId: data.clientId, name };
  saveSession();
  state = data.state;
  errorMessage = "";
  animatedPlayKey = "";
  render();
}

async function action(type, extra = {}) {
  const data = await api(`/api/rooms/${session.roomId}/action`, {
    method: "POST",
    body: JSON.stringify({ type, clientId: session.clientId, ...extra }),
  });
  state = data.state;
  errorMessage = "";
  render();
}

async function leaveRoom() {
  if (session.roomId && session.clientId) {
    try {
      await api(`/api/rooms/${session.roomId}/leave`, {
        method: "POST",
        body: JSON.stringify({ clientId: session.clientId }),
      });
    } catch {
      // Local cleanup is still useful if the room no longer exists.
    }
  }
  resetSession();
  render();
}

async function poll() {
  window.clearTimeout(pollTimer);
  if (!session.roomId || !session.clientId) return;
  try {
    const data = await api(`/api/rooms/${session.roomId}?clientId=${encodeURIComponent(session.clientId)}`);
    state = data.state;
    errorMessage = "";
    render(false);
  } catch (error) {
    if (error.status === 404) {
      resetSession("房间已失效，请重新创建或加入房间");
      render(false);
      return;
    }
    errorMessage = error.message;
    render(false);
  } finally {
    if (session.roomId && session.clientId) pollTimer = window.setTimeout(poll, 800);
  }
}

function renderHome() {
  root.innerHTML = `
    <main class="appShell onlineHome">
      <header class="topBar">
        <div>
          <p>Gongzhu Online</p>
          <h1>联网房间</h1>
        </div>
        <div class="topActions">
          <button class="ghostButton" data-action="rules">规则</button>
          <button class="ghostButton" data-action="score-help">牌分</button>
          <a class="ghostLink" href="/">返回单机版</a>
        </div>
      </header>
      <section class="joinPanel">
        <div>
          <h2>创建房间</h2>
          <input id="createName" placeholder="你的名字" maxlength="12" />
          <button class="primaryButton" data-action="create">创建</button>
        </div>
        <div>
          <h2>加入房间</h2>
          <input id="joinName" placeholder="你的名字" maxlength="12" />
          <input id="roomId" placeholder="房间号" maxlength="4" />
          <button class="primaryButton" data-action="join">加入</button>
        </div>
      </section>
      ${errorMessage ? `<p class="onlineError">${errorMessage}</p>` : ""}
      ${helpModals()}
    </main>
  `;

  root.querySelector('[data-action="create"]').addEventListener("click", async () => {
    try {
      await createRoom(root.querySelector("#createName").value.trim() || "玩家");
    } catch (error) {
      errorMessage = error.message;
      render();
    }
  });

  root.querySelector('[data-action="join"]').addEventListener("click", async () => {
    try {
      await joinRoom(root.querySelector("#roomId").value.trim(), root.querySelector("#joinName").value.trim() || "玩家");
    } catch (error) {
      errorMessage = error.message;
      render();
    }
  });

  bindHelpEvents();
}

function renderRoom() {
  const game = state.game;
  const you = state.you;
  const canStart = state.seats.every((seat) => seat.occupied) && !game;
  const player = game && you >= 0 ? game.players[you] : null;
  const loser = game?.players.find((item) => item.totalScore <= -1600);
  const youReady = you >= 0 && state.seats[you]?.ready;

  root.innerHTML = `
    <main class="appShell">
      <header class="topBar">
        <div>
          <p>Room ${state.roomId}</p>
          <h1>联网拱猪</h1>
        </div>
        <div class="topActions">
          <button class="ghostButton" data-action="rules">规则</button>
          <button class="ghostButton" data-action="score-help">牌分</button>
          <button class="ghostButton" data-action="copy">复制房间号</button>
          <button class="ghostButton" data-action="leave">离开房间</button>
          ${!game ? '<button class="ghostButton" data-action="add-bot">添加人机</button>' : ""}
          <a class="ghostLink" href="/">单机版</a>
          ${canStart ? '<button class="primaryButton" data-action="start">开始游戏</button>' : ""}
        </div>
      </header>
      ${seatList()}
      ${
        !game
          ? `<section class="waitingRoom"><strong>等待 4 名玩家入座</strong><span>把房间号 ${state.roomId} 发给朋友。</span></section>`
          : renderGame(game, player, loser, youReady)
      }
      ${errorMessage ? `<p class="onlineError">${errorMessage}</p>` : ""}
      ${helpModals()}
    </main>
  `;

  bindHelpEvents();
  root.querySelector('[data-action="copy"]')?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(state.roomId);
  });
  root.querySelector('[data-action="leave"]')?.addEventListener("click", () => {
    leaveRoom();
  });
  root.querySelector('[data-action="add-bot"]')?.addEventListener("click", () => action("addBot").catch(setError));
  root.querySelector('[data-action="start"]')?.addEventListener("click", () => action("startGame").catch(setError));

  bindGameEvents(game, player);
}

function renderGame(game, player, loser, youReady) {
  const inReveal = game.phase === "reveal";
  const canShowRevealedCards = !inReveal || youReady;
  return `
    <section class="gameLayout">
      <div class="table">
        ${
          game.phase === "dealing"
            ? `<div class="dealOverlay"><div class="shuffleDeck"><i></i><i></i><i></i></div><strong>洗牌发牌中</strong><span>服务器正在发牌</span></div>`
            : ""
        }
        <div class="felt">
          <div class="roundBadge">第 ${game.roundNumber} 轮 · 第 ${Math.min(game.trickNumber, 13)} 墩</div>
          ${inReveal ? '<div class="roundBadge revealBadge">亮牌阶段</div>' : ""}
          <div class="discardDock"><span>桌面弃牌堆</span><strong>${game.discardPile.length}</strong></div>
          <div class="trickArea"></div>
          <p class="message">${game.phase === "collecting" ? "收墩中..." : game.message}</p>
        </div>
        <section class="humanPanel">
          <div class="handHeader">
            <div><strong>${player.name}</strong><span>${game.currentPlayer === state.you && game.phase === "playing" ? "轮到你出牌" : "等待"}</span></div>
            <span><b class="scoreBadge">累计 ${player.totalScore}</b><b class="roundScoreBadge">本轮 ${player.roundScore}</b>${player.hand.length} 张</span>
          </div>
          ${
            inReveal
              ? `<div class="revealPanel ${youReady ? "readyReveal" : ""}"><div><strong>${youReady ? "已完成亮牌" : "选择亮牌"}</strong><span>${youReady ? "等待其他玩家完成亮牌" : "全部玩家准备后开始本轮"}</span></div><div class="revealChoices"></div><button class="primaryButton startRoundButton" data-action="ready" ${youReady ? "disabled" : ""}>${youReady ? "已完成亮牌" : "完成亮牌"}</button></div>`
              : ""
          }
          <div class="hand"></div>
        </section>
      </div>
      <aside class="sidePanel">
        ${loser ? `<section><p class="lossBanner">${loser.name} 达到 ${loser.totalScore}，本游戏结算。</p></section>` : ""}
        <section><h2>亮牌</h2><div class="shownCards">${
          !canShowRevealedCards
            ? '<span class="emptyPile">完成亮牌后显示</span>'
            : game.revealedCards.length === 0
            ? '<span class="emptyPile">暂无亮牌</span>'
            : game.revealedCards
                .map((item) => {
                  const owner = game.players.find((gamePlayer) => gamePlayer.id === item.playerId);
                  const collected = game.suitOpened.includes(item.suit);
                  return `<span class="shownCard ${collected ? "collectedShownCard" : ""}">${owner?.name ?? ""} ${cardLabelFromId(item.cardId)} x2${collected ? " · 收" : ""}</span>`;
                })
                .join("")
        }</div></section>
        <section><h2>计分牌堆</h2><div class="pileList">${game.players
          .map(
            (item) => `<div class="pileRow"><div><strong>${item.name}</strong><span>${item.buffPile.length} 张</span></div><div class="miniPile">${pilePreview(item.buffPile, game)}</div></div>`,
          )
          .join("")}</div></section>
      </aside>
    </section>
  `;
}

function bindGameEvents(game, player) {
  if (!game || !player) return;
  const lastPlayKey = game.lastPlayed ? `${game.lastPlayed.playerId}-${game.lastPlayed.card.id}` : "";
  const youReady = state.you >= 0 && state.seats[state.you]?.ready;
  let renderedNewPlayAnimation = false;

  const nextPlayer = [2, 3, 1, 0];
  const east = nextPlayer[state.you];
  const north = nextPlayer[east];
  const west = nextPlayer[north];
  const directionClass = new Map([
    [state.you, "dealFrom-p0"],
    [north, "dealFrom-p1"],
    [east, "dealFrom-p2"],
    [west, "dealFrom-p3"],
  ]);
  root.querySelector(".table")?.append(opponent(game.players[north], "north", game));
  root.querySelector(".table")?.append(opponent(game.players[west], "west", game));
  root.querySelector(".table")?.append(opponent(game.players[east], "east", game));

  const trickArea = root.querySelector(".trickArea");
  const visibleTrick = game.trick.length > 0 ? game.trick : game.lastCompletedTrick || [];
  if (trickArea) {
    if (visibleTrick.length === 0) trickArea.innerHTML = "<p>等待出牌</p>";
    for (const play of visibleTrick) {
      const owner = game.players.find((item) => item.id === play.playerId);
      const ownerIndex = game.players.findIndex((item) => item.id === play.playerId);
      const playKey = `${play.playerId}-${play.card.id}`;
      const shouldAnimate = playKey === lastPlayKey && playKey !== animatedPlayKey;
      if (shouldAnimate) renderedNewPlayAnimation = true;
      const played = document.createElement("div");
      played.className = `played ${shouldAnimate ? directionClass.get(ownerIndex) || "" : ""} ${game.phase === "collecting" ? "settledCard" : ""} ${isBuffCard(play.card) ? "buffPlayed" : ""}`;
      played.innerHTML = `<span>${owner?.name ?? ""}</span>`;
      played.append(cardButton(play.card, { disabled: true, revealed: isRevealed(game, play.card.id), collected: isCollectedRevealedCard(game, play.card) }));
      trickArea.append(played);
    }
  }

  const hand = root.querySelector(".hand");
  const legal = new Set(state.legalCardIds);
  for (const card of player.hand) {
    hand.append(
      cardButton(card, {
        revealed: isRevealed(game, card.id),
        collected: isCollectedRevealedCard(game, card),
        locked: isLockedRevealedCard(game, card),
        disabled: game.phase !== "playing" || game.currentPlayer !== state.you || !legal.has(card.id),
        onClick: () => action("playCard", { cardId: card.id }).catch(setError),
      }),
    );
  }

  const revealChoices = root.querySelector(".revealChoices");
  if (revealChoices) {
    const candidates = player.hand.filter(isRevealCandidate);
    if (candidates.length === 0) revealChoices.innerHTML = '<span class="emptyPile">你没有可亮的牌</span>';
    for (const card of candidates) {
      revealChoices.append(
        cardButton(card, {
          revealed: isRevealed(game, card.id),
          collected: isCollectedRevealedCard(game, card),
          disabled: youReady,
          onClick: youReady ? null : () => action("toggleReveal", { cardId: card.id }).catch(setError),
        }),
      );
    }
  }

  root.querySelector('[data-action="ready"]')?.addEventListener("click", () => action("ready").catch(setError));

  if (renderedNewPlayAnimation) {
    animatedPlayKey = lastPlayKey;
  }
}

function setError(error) {
  errorMessage = error.message;
  render();
}

function render(shouldPoll = true) {
  window.clearTimeout(pollTimer);
  if (!session.roomId || !session.clientId || !state) renderHome();
  else renderRoom();
  if (shouldPoll && session.roomId && session.clientId) pollTimer = window.setTimeout(poll, 800);
}

if (session.roomId && session.clientId) {
  poll();
} else {
  renderHome();
}
