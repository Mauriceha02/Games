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

export interface Meld {
  kind: 'set' | 'run' | 'color';
  cards: string[];
  value: number | null;
  color: Color | null;
}

export type BotDifficulty = 'easy' | 'strong';
export type BotSetup = BotDifficulty | 'mixed';
export type BasePhaseSet = 'classic' | 'extreme';
export type PhaseSet = BasePhaseSet | 'mixed';
export interface PhaseTask { set: BasePhaseSet; phase: number }

export interface Player {
  id: string;
  name: string;
  controller: 'human' | 'computer';
  botDifficulty: BotDifficulty | null;
  hand: string[];
  phase: number;
  score: number;
  melds: Meld[];
  skipPending: boolean;
  skipProtected: boolean;
}

export interface GameState {
  version: 5;
  phaseSet: PhaseSet;
  phaseOrder: PhaseTask[];
  status: 'playing' | 'round-over' | 'finished';
  roundWinner: string | null;
  winner: string | null;
  tieBreak: boolean;
  finalists: string[] | null;
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
