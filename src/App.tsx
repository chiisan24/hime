import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Home } from './pages/Home'
import { Candidates } from './pages/Candidates'
import { CandidateDetail } from './pages/CandidateDetail'
import { Compare } from './pages/Compare'
import { PollingPlace } from './pages/PollingPlace'
import { Chat } from './pages/Chat'
import { More } from './pages/More'
import { Schedule } from './pages/Schedule'
import { Guide } from './pages/Guide'
import { Reminder } from './pages/Reminder'
import { Settings } from './pages/Settings'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />

          <Route path="candidates" element={<Candidates />} />
          <Route path="candidates/:id" element={<CandidateDetail />} />
          <Route path="compare" element={<Compare />} />
          <Route path="polling" element={<PollingPlace />} />
          <Route path="chat" element={<Chat />} />
          <Route path="more" element={<More />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="guide" element={<Guide />} />
          <Route path="reminder" element={<Reminder />} />
          <Route path="settings" element={<Settings />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
