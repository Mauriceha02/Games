export type Color = 'red' | 'blue' | 'green' | 'yellow';

export type Card = {
  id: string;
  asset: string;
} & (
  | { type: 'number'; color: Color; value: number }
  | { type: 'wild' | 'skip'; color: null; value: null }
);

export type Catalog = ReadonlyMap<string, Card>;
export type Random = () => number;

export interface Player {
  id: string;
  name: string;
  controller: 'human' | 'computer';
  hand: string[];
  skipPending: boolean;
  skipProtected: boolean;
}

export interface GameState {
  version: 1;
  round: number;
  players: Player[];
  currentPlayer: number;
  stage: 'draw' | 'discard';
  stock: string[];
  discard: string[];
  drawnCard: string | null;
  turn: number;
  history: string[];
}
