import { useEffect, useState } from 'react'
import './App.css'

type Health = {
  status: string
  database: string
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <main>
      <h1>Internal Employee Portal</h1>
      <h2>Health check</h2>
      {error && <p>error: {error}</p>}
      {!error && !health && <p>checking...</p>}
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
    </main>
  )
}

export default App
