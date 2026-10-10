import { discardCard, drawCard, eligibleSkipTargets } from '../game/game.js';
import type { Catalog, GameState } from '../game/types.js';

/** Basic turn flow only. Choosing cards for phases is the next development step. */
export function playBasicTurnStep(state: GameState, catalog: Catalog): GameState {
  const player = state.players[state.currentPlayer]!;
  if (player.controller !== 'computer') throw new Error('Der menschliche Spieler entscheidet selbst.');
  if (state.stage === 'draw') return drawCard(state, catalog, player.id, 'stock');
  const target = eligibleSkipTargets(state)[0];
  let id = state.drawnCard!;
  if (catalog.get(id)!.type === 'skip' && !target) {
    id = player.hand.find(cardId => catalog.get(cardId)!.type !== 'skip')!;
  }
  return discardCard(state, catalog, player.id, id, catalog.get(id)!.type === 'skip' ? target!.id : null);
}
