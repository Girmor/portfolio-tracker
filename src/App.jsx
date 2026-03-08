import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Overview from './components/Overview'
import Portfolios from './components/Portfolios'
import PortfolioDetail from './components/PortfolioDetail'
import Budget from './components/Budget'
import Dividends from './components/Dividends'
import Snapshots from './components/Snapshots'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/portfolios" element={<Portfolios />} />
        <Route path="/portfolios/:id" element={<PortfolioDetail />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/dividends" element={<Dividends />} />
        <Route path="/snapshots" element={<Snapshots />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default App
