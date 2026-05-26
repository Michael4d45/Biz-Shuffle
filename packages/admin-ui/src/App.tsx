import { GamesCard } from "./components/GamesCard.js";
import { LogsCard } from "./components/LogsCard.js";
import { PlayersCard } from "./components/PlayersCard.js";
import { PluginsCard } from "./components/PluginsCard.js";
import { SessionCard } from "./components/SessionCard.js";
import { swapProgress } from "./swapDisplay.js";
import { useAdmin } from "./useAdmin.js";

export function App() {
  const { state, log, pushLog, wsConnected, refreshState, trigger } = useAdmin();

  return (
    <main className="layout">
      <div className="progress-top" style={{ transform: `scaleX(${swapProgress(state) / 100})` }} />

      <header className="row header">
        <h1>BizShuffle Admin</h1>
        <span className={wsConnected ? "ok" : "err"}>WS {wsConnected ? "on" : "off"}</span>
      </header>

      <div className="grid">
        <SessionCard state={state} trigger={trigger} />
        <PlayersCard state={state} trigger={trigger} />
        <GamesCard state={state} trigger={trigger} pushLog={pushLog} refreshState={refreshState} />
        <PluginsCard trigger={trigger} pushLog={pushLog} />
        <LogsCard log={log} />
      </div>
    </main>
  );
}
