import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './components/Login'
import Overview from './components/Overview'
import Portfolios from './components/Portfolios'
import PortfolioDetail from './components/PortfolioDetail'
import Budget from './components/Budget'
import Dividends from './components/Dividends'
import Snapshots from './components/Snapshots'
import TradeHistory from './components/TradeHistory'
import ImportTrades from './components/ImportTrades'
import ErrorBoundary from './components/ErrorBoundary'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <span className="text-sm text-gray-500">Завантаження...</span>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <ErrorBoundary>{children}</ErrorBoundary>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/portfolios" element={<Portfolios />} />
              <Route path="/portfolios/:id" element={<PortfolioDetail />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/dividends" element={<Dividends />} />
              <Route path="/trades" element={<TradeHistory />} />
              <Route path="/import" element={<ImportTrades />} />
              <Route path="/snapshots" element={<Snapshots />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

export default App
