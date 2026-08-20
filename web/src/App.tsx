import { useEffect, useState } from 'react'

type Health = { status: string; postgres: boolean; redis: boolean }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)))
  }, [])

  return (
    <main style={{ maxWidth: 560, margin: '96px auto', padding: '0 16px' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 40, margin: 0 }}>
        ChordCraft
      </h1>
      <p style={{ color: 'var(--ink-2)' }}>Scaffolding is up. The editor lands in M1.</p>
      <pre
        style={{
          fontFamily: 'var(--font-mono)',
          background: 'var(--paper-raised)',
          border: '1px solid var(--hairline)',
          borderRadius: 8,
          padding: 12,
        }}
      >
        {error
          ? `API unreachable: ${error}`
          : health
            ? JSON.stringify(health, null, 2)
            : 'Checking API…'}
      </pre>
    </main>
  )
}

export default App
