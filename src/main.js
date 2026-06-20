import {
  chooseBotCard,
  createGame,
  createNextRound,
  finishCollecting,
  isBuffCard,
  isLockedRevealedCard,
  isRevealCandidate,
  isRevealed,
  legalCards,
  playCard,
  startPlaying,
  startRevealPhase,
  suitLabel,
  suitName,
  toggleRevealCard,
} from "./game.js";

let game = createGame();
let botTimer = 0;
let dealTimer = 0;
let collectTimer = 0;
let nextRoundTimer = 0;
let animatedPlayKey = "";
let scoreHelpOpen = false;
let rulesOpen = false;

const root = document.querySelector("#root");

function cardButton(card, options = {}) {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  const specialLabel =
    card.suit === "spades" && card.rank === "Q"
      ? "猪"
      : card.suit === "diamonds" && card.rank === "J"
        ? "羊"
        : card.suit === "clubs" && card.rank === "10"
          ? "变"
          : "";
  const button = document.createElement("button");
  button.className = `card ${red ? "red" : "black"} ${specialLabel ? "specialCard" : ""} ${options.revealed ? "revealedCard" : ""} ${options.locked ? "lockedCard" : ""}`;
  button.disabled = Boolean(options.disabled);
  button.innerHTML = `${specialLabel ? `<i>${specialLabel}</i>` : ""}<span>${card.rank}</span><strong>${suitLabel[card.suit]}</strong><small>${options.revealed ? "亮 x2" : suitName[card.suit]}</small>`;
  if (options.onClick) button.addEventListener("click", options.onClick);
  return button;
}

function cardLabelFromId(cardId) {
  const [suit, rank] = cardId.split("-");
  return `${suitLabel[suit] ?? ""}${rank ?? ""}`;
}

function pilePreview(cards, limit = 7) {
  if (cards.length === 0) return '<span class="emptyPile">空</span>';
  return cards
    .slice(-limit)
    .map((card) => {
      const revealed = isRevealed(game, card.id);
      return `<span class="miniCard ${card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black"} ${revealed ? "revealedMini" : ""}">${suitLabel[card.suit]}${card.rank}${revealed ? "×2" : ""}</span>`;
    })
    .join("");
}

function opponent(player, position) {
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

function render() {
  window.clearTimeout(botTimer);
  window.clearTimeout(dealTimer);
  window.clearTimeout(collectTimer);
  window.clearTimeout(nextRoundTimer);
  const humanLegalCards = new Set(game.phase === "playing" ? legalCards(game, 0).map((card) => card.id) : []);
  const waitingForDeal = game.phase === "dealing";
  const inReveal = game.phase === "reveal";
  const humanRevealCards = game.players[0].hand.filter(isRevealCandidate);
  const loser = game.players.find((player) => player.totalScore <= -1600);
  const lastPlayKey = game.lastPlayed ? `${game.lastPlayed.playerId}-${game.lastPlayed.card.id}` : "";
  let renderedNewPlayAnimation = false;

  root.innerHTML = `
    <main class="appShell">
      <header class="topBar">
        <div>
          <p>Gongzhu Online</p>
          <h1>拱猪在线桌</h1>
        </div>
        <div class="topActions">
          <a class="ghostLink" href="/online.html">联网版</a>
          <button type="button" class="ghostButton" data-action="rules">规则</button>
          <button type="button" class="ghostButton" data-action="score-help">牌分</button>
          <button type="button" class="primaryButton" data-action="new">新游戏</button>
        </div>
      </header>
      <section class="gameLayout">
        <div class="table">
          ${
            waitingForDeal
              ? `<div class="dealOverlay">
                  <div class="shuffleDeck"><i></i><i></i><i></i></div>
                  <strong>洗牌发牌中</strong>
                  <span>正在分发 52 张牌</span>
                </div>`
              : ""
          }
          <div class="felt">
            <div class="roundBadge">第 ${game.roundNumber} 轮 · 第 ${Math.min(game.trickNumber, 13)} 墩</div>
            ${inReveal ? '<div class="roundBadge revealBadge">亮牌阶段</div>' : ""}
            <div class="discardDock">
              <span>桌面弃牌堆</span>
              <strong>${game.discardPile.length}</strong>
            </div>
            <div class="trickArea"></div>
            <p class="message">${game.phase === "collecting" ? "收墩中..." : game.message}</p>
          </div>
          <section class="humanPanel">
            <div class="handHeader">
              <div><strong>${game.players[0].name}</strong><span>${game.currentPlayer === 0 && !game.finished && game.phase === "playing" ? "轮到你出牌" : "等待其他玩家"}</span></div>
              <span><b class="scoreBadge">累计 ${game.players[0].totalScore}</b><b class="roundScoreBadge">本轮 ${game.players[0].roundScore}</b>${game.players[0].hand.length} 张</span>
            </div>
            ${
              inReveal
                ? `<div class="revealPanel">
                    <div>
                      <strong>选择亮牌</strong>
                      <span>亮出的牌效果翻倍；该花色第一次出现后才解锁可打</span>
                    </div>
                    <div class="revealChoices"></div>
                    <button type="button" class="primaryButton startRoundButton" data-action="start-round">开始本轮</button>
                  </div>`
                : ""
            }
            <div class="hand"></div>
          </section>
        </div>
        <aside class="sidePanel">
          ${loser ? `<section><p class="lossBanner">${loser.name} 达到 ${loser.totalScore}，本游戏结算。</p></section>` : ""}
          <section>
            <h2>亮牌</h2>
            <div class="shownCards">
              ${
                game.revealedCards.length === 0
                  ? '<span class="emptyPile">暂无亮牌</span>'
                  : game.revealedCards
                      .map((item) => {
                        const owner = game.players.find((player) => player.id === item.playerId);
                        return `<span class="shownCard">${owner?.name ?? ""} ${cardLabelFromId(item.cardId)} x2</span>`;
                      })
                      .join("")
              }
            </div>
          </section>
          <section>
            <h2>计分牌堆</h2>
            <div class="pileList">
              ${game.players
                .map(
                  (player) => `
                    <div class="pileRow">
                      <div><strong>${player.name}</strong><span>${player.buffPile.length} 张</span></div>
                      <div class="miniPile">${pilePreview(player.buffPile)}</div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
        </aside>
      </section>
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
                  <li>其他红桃：每张 -10</li>
                  <li>黑桃 Q：-100</li>
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
                  <li>每轮开始前可亮黑桃 Q、方块 J、梅花 10 或红桃 A；亮牌效果翻倍，且该花色第一次出现后才可打出。</li>
                  <li>每轮结束自动累计分数，累计到 -1600 的玩家输掉本游戏。</li>
                </ul>
              </section>
            </div>`
          : ""
      }
    </main>
  `;

  const table = root.querySelector(".table");
  table.append(opponent(game.players[1], "north"));
  table.append(opponent(game.players[3], "west"));
  table.append(opponent(game.players[2], "east"));

  const trickArea = root.querySelector(".trickArea");
  const visibleTrick = game.trick.length > 0 ? game.trick : game.lastCompletedTrick || [];
  if (visibleTrick.length === 0) {
    trickArea.innerHTML = "<p>等待出牌</p>";
  } else {
    for (const play of visibleTrick) {
      const player = game.players.find((item) => item.id === play.playerId);
      const playKey = `${play.playerId}-${play.card.id}`;
      const isLatest = playKey === lastPlayKey;
      const shouldAnimate = isLatest && playKey !== animatedPlayKey;
      if (shouldAnimate) renderedNewPlayAnimation = true;
      const played = document.createElement("div");
      played.className = `played ${shouldAnimate ? `dealFrom-${play.playerId}` : ""} ${game.phase === "collecting" ? "settledCard" : ""} ${isBuffCard(play.card) ? "buffPlayed" : ""}`;
      played.innerHTML = `<span>${player?.name ?? ""}</span>`;
      played.append(cardButton(play.card, { disabled: true }));
      trickArea.append(played);
    }
  }

  const hand = root.querySelector(".hand");
  for (const card of game.players[0].hand) {
    const revealed = isRevealed(game, card.id);
    const locked = isLockedRevealedCard(game, card);
    hand.append(
      cardButton(card, {
        revealed,
        locked,
        disabled: game.phase !== "playing" || game.currentPlayer !== 0 || !humanLegalCards.has(card.id) || game.finished,
        onClick: () => {
          game = playCard(game, 0, card.id);
          render();
        },
      }),
    );
  }

  const revealChoices = root.querySelector(".revealChoices");
  if (revealChoices) {
    if (humanRevealCards.length === 0) {
      revealChoices.innerHTML = '<span class="emptyPile">你没有可亮的牌</span>';
    } else {
      for (const card of humanRevealCards) {
        revealChoices.append(
          cardButton(card, {
            revealed: isRevealed(game, card.id),
            onClick: () => {
              game = toggleRevealCard(game, 0, card.id);
              render();
            },
          }),
        );
      }
    }
  }

  root.querySelector('[data-action="new"]').addEventListener("click", () => {
    game = createGame();
    animatedPlayKey = "";
    scoreHelpOpen = false;
    rulesOpen = false;
    render();
  });

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

  root.querySelector('[data-action="start-round"]')?.addEventListener("click", () => {
    game = startPlaying(game);
    render();
  });

  if (renderedNewPlayAnimation) {
    animatedPlayKey = lastPlayKey;
  }

  if (waitingForDeal) {
    dealTimer = window.setTimeout(() => {
      game = startRevealPhase(game);
      render();
    }, 625);
    return;
  }

  if (game.phase === "collecting") {
    collectTimer = window.setTimeout(() => {
      game = finishCollecting(game);
      render();
    }, 1050);
    return;
  }

  if (game.phase === "roundFinished") {
    nextRoundTimer = window.setTimeout(() => {
      game = createNextRound(game);
      animatedPlayKey = "";
      render();
    }, 1200);
    return;
  }

  if (game.currentPlayer !== 0 && !game.finished && game.phase === "playing") {
    botTimer = window.setTimeout(() => {
      const playerIndex = game.currentPlayer;
      const player = game.players[playerIndex];
      if (game.thinkingPlayer !== player.id) {
        game = { ...game, thinkingPlayer: player.id, message: `${player.name} 正在思考...` };
        render();
        return;
      }

      const card = chooseBotCard(game, legalCards(game, playerIndex));
      game = playCard(game, playerIndex, card.id);
      render();
    }, game.thinkingPlayer ? 425 : 240);
  }
}

render();
