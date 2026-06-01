import { Route, Routes } from 'react-router-dom'
import { AppearanceEffects } from './components/AppearanceEffects'
import { Home } from './pages/Home'
import { Room } from './pages/Room'
import './App.css'

function App() {
  return (
    <>
      <AppearanceEffects />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </>
  )
}

export default App
