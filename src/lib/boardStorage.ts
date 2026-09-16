const legacyBoardKeys = [
  "vcg-wins-board-data",
  "vcg-wins-board-archive",
  "vcg-wins-board-activity",
  "vcg-total-wins",
  "vcg-wins-target",
  "vcg-wins-target-v2",
];

// Older clients cached private records outside Firebase's access controls.
// Remove only those caches; retain Firebase's session and unrelated preferences.
export function clearLegacyBoardStorage() {
  for (const key of legacyBoardKeys) {
    try { window.localStorage.removeItem(key); }
    catch { /* Storage may be unavailable in restricted browsers. */ }
  }
}

export function createBoardStorage(allowPersistence: boolean) {
  return {
    getItem(key: string): string | null {
      if (!allowPersistence) return null;
      try { return window.localStorage.getItem(key); }
      catch { return null; }
    },
    setItem(key: string, value: string) {
      if (!allowPersistence) return;
      try { window.localStorage.setItem(key, value); }
      catch { /* A storage failure must not prevent the board from rendering. */ }
    },
  };
}
