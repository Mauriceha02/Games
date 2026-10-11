interface Summary { card: number; score: number; finished: boolean }
interface GruselinoModule {
  mountGruselino(root: HTMLElement, options: { onHome(): void }): { dispose(): void };
  getSavedSummary(): Summary | null;
}
let modulePromise: Promise<GruselinoModule> | null = null;

export function loadGruselino(): Promise<GruselinoModule> {
  if (!modulePromise) {
    const url = new URL('./public/games/gruselino/app/ui/game-app.js', document.baseURI);
    modulePromise = import(url.href).then(module => {
      if (typeof module.mountGruselino !== 'function' || typeof module.getSavedSummary !== 'function') throw new Error('Ungültiges Gruselino-Modul.');
      return module as GruselinoModule;
    }).catch(error => { modulePromise = null; throw error; });
  }
  return modulePromise;
}
