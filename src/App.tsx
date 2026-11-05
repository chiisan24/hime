import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { Home } from './pages/Home'
import { Placeholder } from './pages/Placeholder'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />

          {/* 以降のSTEPで実装予定（現在は仮表示） */}
          <Route path="candidates" element={<Placeholder title="候補者一覧" />} />
          <Route path="candidates/:id" element={<Placeholder title="候補者詳細" />} />
          <Route path="compare" element={<Placeholder title="政策比較" />} />
          <Route path="polling" element={<Placeholder title="投票所検索" />} />
          <Route path="chat" element={<Placeholder title="AIに質問" />} />
          <Route path="more" element={<Placeholder title="その他" />} />
          <Route path="schedule" element={<Placeholder title="投票日・選挙日程" />} />
          <Route path="guide" element={<Placeholder title="投票方法ガイド" />} />
          <Route path="reminder" element={<Placeholder title="投票日リマインダー" />} />
          <Route path="settings" element={<Placeholder title="表示・読み上げ設定" />} />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
