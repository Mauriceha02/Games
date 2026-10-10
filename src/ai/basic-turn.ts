import { discardCard, drawCard, eligibleSkipTargets, hitMeld, layPhase } from '../game/game.js';
import { extendMeld, findPhase } from '../game/phases.js';
import type { Catalog, GameState } from '../game/types.js';

/** Basic legal moves; strategic planning can be added independently later. */
export function playBasicTurnStep(state: GameState, catalog: Catalog): GameState {
  const player = state.players[state.currentPlayer]!;
  if (player.controller !== 'computer') throw new Error('Der menschliche Spieler entscheidet selbst.');
  if (state.stage === 'draw') return drawCard(state, catalog, player.id, 'stock');
  if (!player.melds.length) {
    const phase = findPhase(player.hand, player.phase, catalog);
    if (phase) return layPhase(state, catalog, player.id, phase);
  } else {
    for (const owner of state.players) {
      for (let index = 0; index < owner.melds.length; index++) {
        const id = player.hand.find(card => extendMeld(owner.melds[index]!, [card], catalog));
        if (id) return hitMeld(state, catalog, player.id, [id], owner.id, index);
      }
    }
  }
  const target = eligibleSkipTargets(state)[0];
  let id = player.hand.includes(state.drawnCard!) ? state.drawnCard! : player.hand[0]!;
  if (catalog.get(id)!.type === 'skip' && !target) id = player.hand.find(cardId => catalog.get(cardId)!.type !== 'skip')!;
  return discardCard(state, catalog, player.id, id, catalog.get(id)!.type === 'skip' ? target!.id : null);
}
