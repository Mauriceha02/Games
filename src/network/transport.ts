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
export async function loadTransport(): Promise<{ transport: Transport; signals: Signals }> {
  const [transport, signals] = await Promise.all([
    import(new URL('./peer.js', import.meta.url).href) as Promise<Transport>,
    import(new URL('./signals.js', import.meta.url).href) as Promise<Signals>,
  ]);
  return { transport, signals };
}
