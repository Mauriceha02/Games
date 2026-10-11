export type Role = 'host' | 'guest';
export interface Peer {
  state: string;
  role: Role | null;
  createInvitation(game: 'phase10' | 'gruselino', internet: boolean): Promise<string>;
  joinInvitation(raw: string): Promise<string>;
  acceptAnswer(raw: string): Promise<void>;
  send(data: unknown): void;
  close(): void;
}
export interface Transport {
  LocalPeer: new (options: { onState(state: string, message: string): void; onMessage(message: unknown): void }) => Peer;
}
export interface Signals { readSignal(raw: string): { game: string; type: string } }
export interface RoomLink { create(game: 'phase10' | 'gruselino', internet: boolean): Promise<string>; join(raw: string, game: 'phase10' | 'gruselino'): Promise<void>; close(): void }
export interface Rooms {
  getServiceURL(): Promise<string | null>;
  readRoomInvite(raw: string): { game: string } | null;
  RoomLink: new (service: string, peer: Peer, onError: (message: string) => void) => RoomLink;
}
export async function loadTransport(): Promise<{ transport: Transport; signals: Signals; rooms: Rooms }> {
  const [transport, signals, rooms] = await Promise.all([
    import(new URL('./peer.js', import.meta.url).href) as Promise<Transport>,
    import(new URL('./signals.js', import.meta.url).href) as Promise<Signals>,
    import(new URL('./rooms.js', import.meta.url).href) as Promise<Rooms>,
  ]);
  return { transport, signals, rooms };
}
