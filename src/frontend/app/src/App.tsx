import { useEffect, useState } from 'react'
import { fetchHealth } from './network/api'
import './App.css'

function App() {
  const [status, setStatus] = useState<string>('checking...')

  useEffect(() => {
    fetchHealth()
      .then(data => setStatus(data.status))
      .catch(err => setStatus('error: ' + err.message))
  }, [])

  return (
    <>
      <h1>Cocanvas 首个联通测试</h1>
      <p>Backend Status: <strong>{status}</strong></p>
    </>
  )
}

export default App
