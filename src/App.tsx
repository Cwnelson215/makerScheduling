/**
 * Placeholder shell. V1 ships the solver core only — the availability grid editor,
 * coverage setup, and ranked-results view land in phase 2 on top of `src/core`.
 */
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <h1>Schedule Maker</h1>
      <p>
        Solver core is implemented in <code>src/core</code>. The UI is not built yet — run the
        solver from the CLI:
      </p>
      <pre>npm run solve -- src/fixtures/small-cafe.json</pre>
    </main>
  )
}
