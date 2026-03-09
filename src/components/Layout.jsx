import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Огляд', icon: '📊' },
  { to: '/portfolios', label: 'Портфелі', icon: '💼' },
  { to: '/trades', label: 'Угоди', icon: '📋' },
  { to: '/import', label: 'Імпорт', icon: '📥' },
  { to: '/budget', label: 'Бюджет', icon: '💰' },
  { to: '/dividends', label: 'Дивіденди', icon: '💵' },
  { to: '/snapshots', label: 'Снепшоти', icon: '📸' },
]

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 p-4 flex flex-col gap-1 shrink-0">
        <h1 className="text-lg font-bold text-gray-800 mb-4 px-3">Portfolio Tracker</h1>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  )
}
