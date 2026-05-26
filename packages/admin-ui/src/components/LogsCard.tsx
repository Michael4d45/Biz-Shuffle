type Props = {
  log: string[];
};

export function LogsCard({ log }: Props) {
  return (
    <section className="card span2">
      <h2>Logs</h2>
      <div className="log">
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </section>
  );
}
