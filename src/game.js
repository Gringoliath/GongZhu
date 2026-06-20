const suits = ["spades", "hearts", "diamonds", "clubs"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValue = new Map(ranks.map((rank, index) => [rank, index]));
const counterClockwiseNext = [2, 3, 1, 0];

export const suitLabel = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export const suitName = {
  spades: "黑桃",
  hearts: "红桃",
  diamonds: "方块",
  clubs: "梅花",
};

export function isBuffCard(card) {
  return card.suit === "hearts" || (card.suit === "spades" && card.rank === "Q") || (card.suit === "diamonds" && card.rank === "J") || (card.suit === "clubs" && card.rank === "10");
}

export function isRevealCandidate(card) {
  return (
    (card.suit === "spades" && card.rank === "Q") ||
    (card.suit === "diamonds" && card.rank === "J") ||
    (card.suit === "clubs" && card.rank === "10") ||
    (card.suit === "hearts" && card.rank === "A")
  );
}

function createDeck() {
  return suits.flatMap((suit) => ranks.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })));
}

function shuffle(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function sortHand(cards) {
  const suitOrder = new Map([
    ["spades", 0],
    ["hearts", 1],
    ["diamonds", 2],
    ["clubs", 3],
  ]);

  return [...cards].sort((a, b) => {
    const suitDiff = suitOrder.get(a.suit) - suitOrder.get(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return rankValue.get(a.rank) - rankValue.get(b.rank);
  });
}

export function scoreCards(cards, revealedCards = []) {
  let score = 0;
  let multiplier = 1;
  const revealedIds = new Set(revealedCards.map((item) => item.cardId));
  const heartCount = cards.filter((card) => card.suit === "hearts").length;

  if (heartCount === 13) score += 200;

  for (const card of cards) {
    const revealedMultiplier = revealedIds.has(card.id) ? 2 : 1;
    if (card.suit === "hearts" && heartCount !== 13) {
      const heartScore = card.rank === "A" ? 50 : card.rank === "K" ? 40 : card.rank === "Q" ? 30 : card.rank === "J" ? 20 : ["2", "3", "4", "5"].includes(card.rank) ? 0 : 10;
      score -= heartScore * revealedMultiplier;
    }
    if (card.suit === "spades" && card.rank === "Q") score -= 200 * revealedMultiplier;
    if (card.suit === "diamonds" && card.rank === "J") score += 100 * revealedMultiplier;
    if (card.suit === "clubs" && card.rank === "10") multiplier *= 2 * revealedMultiplier;
  }

  return score * multiplier;
}

function createRound(totalScores = [0, 0, 0, 0], roundNumber = 1) {
  const deck = shuffle(createDeck());
  const players = ["你", "北家", "东家", "西家"].map((name, index) => ({
    id: `p${index}`,
    name,
    hand: sortHand(deck.slice(index * 13, index * 13 + 13)),
    buffPile: [],
    roundScore: 0,
    totalScore: totalScores[index] ?? 0,
  }));
  const firstPlayer = players.findIndex((player) => player.hand.some((card) => card.suit === "clubs" && card.rank === "2"));

  return {
    roundNumber,
    players,
    currentPlayer: firstPlayer,
    leader: firstPlayer,
    trick: [],
    discardPile: [],
    trickNumber: 1,
    phase: "dealing",
    suitOpened: [],
    revealedCards: [],
    thinkingPlayer: null,
    lastPlayed: null,
    lastWinner: null,
    lastCompletedTrick: null,
    message: `${players[firstPlayer].name} 摸到梅花 2，本轮先手`,
    finished: false,
    gameOver: false,
  };
}

export function createGame() {
  return createRound();
}

export function createNextRound(state) {
  return createRound(
    state.players.map((player) => player.totalScore),
    state.roundNumber + 1,
  );
}

export function startRevealPhase(state) {
  if (state.phase !== "dealing") return state;
  return {
    ...state,
    phase: "reveal",
    message: "本轮开始前，可亮黑桃Q、方块J、梅花10或红桃A。亮牌效果翻倍，且该花色首次出现并收墩后才能打出。",
  };
}

export function startPlaying(state) {
  if (state.phase !== "reveal") return state;
  return {
    ...state,
    phase: "playing",
    message: `${state.players[state.currentPlayer].name} 先手，请按逆时针顺序出牌`,
  };
}

export function toggleRevealCard(state, playerIndex, cardId) {
  if (state.phase !== "reveal") return state;
  const player = state.players[playerIndex];
  const card = player.hand.find((item) => item.id === cardId);
  if (!card || !isRevealCandidate(card)) return state;

  const alreadyRevealed = state.revealedCards.some((item) => item.cardId === cardId);
  return {
    ...state,
    revealedCards: alreadyRevealed
      ? state.revealedCards.filter((item) => item.cardId !== cardId)
      : [...state.revealedCards, { playerId: player.id, cardId, suit: card.suit }],
  };
}

export function isRevealed(state, cardId) {
  return state.revealedCards.some((item) => item.cardId === cardId);
}

export function isLockedRevealedCard(state, card) {
  return isRevealed(state, card.id) && !state.suitOpened.includes(card.suit);
}

export function legalCards(state, playerIndex) {
  const player = state.players[playerIndex];
  const playableHand = player.hand.filter((card) => !isLockedRevealedCard(state, card));
  if (playableHand.length === 0) return player.hand;
  const leadSuit = state.trick[0]?.card.suit;
  if (!leadSuit) return playableHand;
  const followSuitCards = playableHand.filter((card) => card.suit === leadSuit);
  return followSuitCards.length > 0 ? followSuitCards : playableHand;
}

export function playCard(state, playerIndex, cardId) {
  if (state.finished || state.phase !== "playing" || state.currentPlayer !== playerIndex) return state;

  const player = state.players[playerIndex];
  const legal = legalCards(state, playerIndex);
  if (!legal.some((card) => card.id === cardId)) {
    return { ...state, message: "必须跟首牌花色" };
  }

  const card = player.hand.find((item) => item.id === cardId);
  if (!card) return state;

  const players = state.players.map((item, index) =>
    index === playerIndex ? { ...item, hand: item.hand.filter((handCard) => handCard.id !== cardId) } : item,
  );
  const trick = [...state.trick, { playerId: player.id, card }];
  const playedState = {
    ...state,
    players,
    trick,
    thinkingPlayer: null,
    lastPlayed: { playerId: player.id, card },
    lastWinner: null,
    lastCompletedTrick: null,
  };

  if (trick.length < 4) {
    return {
      ...playedState,
      currentPlayer: counterClockwiseNext[playerIndex],
      message: `${player.name} 出了 ${suitLabel[card.suit]}${card.rank}`,
    };
  }

  const leadSuit = trick[0].card.suit;
  const winnerPlay = trick
    .filter((play) => play.card.suit === leadSuit)
    .reduce((best, play) => (rankValue.get(play.card.rank) > rankValue.get(best.card.rank) ? play : best));
  const winnerIndex = players.findIndex((item) => item.id === winnerPlay.playerId);
  const trickCards = trick.map((play) => play.card);
  const collectedSuits = [...new Set(trickCards.map((trickCard) => trickCard.suit))];
  const suitOpened = [...new Set([...state.suitOpened, ...collectedSuits])];
  const buffCards = trickCards.filter(isBuffCard);
  const plainCards = trickCards.filter((trickCard) => !isBuffCard(trickCard));
  const nextPlayers = players.map((item, index) => {
    const nextBuffPile = index === winnerIndex ? [...item.buffPile, ...buffCards] : item.buffPile;
    return { ...item, buffPile: nextBuffPile, roundScore: scoreCards(nextBuffPile, state.revealedCards) };
  });
  const roundFinished = nextPlayers.every((item) => item.hand.length === 0);
  const settledPlayers = roundFinished
    ? nextPlayers.map((item) => ({ ...item, totalScore: item.totalScore + item.roundScore }))
    : nextPlayers;
  const gameOver = settledPlayers.some((item) => item.totalScore <= -1600);

  return {
    ...playedState,
    players: settledPlayers,
    trick: [],
    lastCompletedTrick: trick,
    discardPile: [...state.discardPile, ...plainCards],
    leader: winnerIndex,
    currentPlayer: winnerIndex,
    trickNumber: state.trickNumber + 1,
    phase: "collecting",
    suitOpened,
    lastWinner: nextPlayers[winnerIndex].id,
    finished: roundFinished,
    gameOver,
    message: roundFinished
      ? gameOver
        ? "游戏结算：有人累计分到 -1600"
        : "本轮结束"
      : `${nextPlayers[winnerIndex].name} 赢得本墩，${buffCards.length} 张计分牌收入牌堆`,
  };
}

export function finishCollecting(state) {
  if (state.phase !== "collecting") return state;
  return {
    ...state,
    phase: state.finished ? (state.gameOver ? "gameOver" : "roundFinished") : "playing",
    lastCompletedTrick: null,
    message: state.finished ? (state.gameOver ? "游戏结束" : "本轮结束，可以开始下一轮") : `${state.players[state.currentPlayer].name} 先手`,
  };
}

export function chooseBotCard(state, cards) {
  const leadSuit = state.trick[0]?.card.suit;
  const sorted = sortHand(cards);
  if (!leadSuit) return sorted[0];

  const followSuitCards = sorted.filter((card) => card.suit === leadSuit);
  if (followSuitCards.length > 0) return followSuitCards[0];

  const pig = sorted.find((card) => card.suit === "spades" && card.rank === "Q");
  if (pig) return pig;
  return sorted[sorted.length - 1];
}
