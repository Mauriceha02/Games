import { assertGameState, discardCard, drawCard, hitMeld, layPhase } from '../game/game.js';
import { chooseBotMove, createBotView } from './strategy.js';
import type { Catalog, GameState } from '../game/types.js';

/** One visible action at a time, saved by the app before the next action. */
export function playBasicTurnStep(state: GameState, catalog: Catalog): GameState {
  assertGameState(state, catalog);
  const view = createBotView(state);
  const move = chooseBotMove(view, catalog);
  switch (move.kind) {
    case 'draw': return drawCard(state, catalog, view.id, move.source);
    case 'lay': return layPhase(state, catalog, view.id, move.cards);
    case 'hit': return hitMeld(state, catalog, view.id, move.cards, move.owner, move.group);
    case 'discard': return discardCard(state, catalog, view.id, move.card, move.target);
  }
}
