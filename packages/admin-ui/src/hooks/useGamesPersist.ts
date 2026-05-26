import { useCallback } from "react";
import { postGames, type GamesPayload } from "../api.js";

export function useGamesPersist(onLog: (msg: string) => void) {
  return useCallback(
    async (payload: GamesPayload) => {
      const res = await postGames(payload);
      if (!res.ok) {
        const detail = (await res.text()).trim();
        onLog(`save games failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
        return false;
      }
      onLog("games saved");
      return true;
    },
    [onLog]
  );
}
