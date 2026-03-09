import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'

const NAV = [
  { to: '/', label: 'Огляд', icon: '📊' },
  {
    label: 'Портфелі',
    icon: '💼',
    children: [
      { to: '/portfolios', label: 'Портфелі', icon: '💼' },
      { to: '/trades', label: 'Угоди', icon: '📋' },
      { to: '/dividends', label: 'Дивіденди', icon: '💵' },
      { to: '/import', label: 'Імпорт', icon: '📥' },
    ],
  },
  { to: '/budget', label: 'Бюджет', icon: '💰' },
  { to: '/snapshots', label: 'Снепшоти', icon: '📸' },
]

export default function Layout({ children }) {
  const location = useLocation()

  // Auto-expand group if current path matches a child
  const isChildActive = (group) =>
    group.children?.some(c => location.pathname === c.to || location.pathname.startsWith(c.to + '/'))

  const [expandedGroups, setExpandedGroups] = useState(() => {
    const open = {}
    NAV.forEach((item, i) => {
      if (item.children && isChildActive(item)) open[i] = true
    })
    return open
  })

  // Keep group open when navigating to its children
  useEffect(() => {
    setExpandedGroups(prev => {
      const next = { ...prev }
      NAV.forEach((item, i) => {
        if (item.children && isChildActive(item)) next[i] = true
      })
      return next
    })
  }, [location.pathname])

  function toggleGroup(idx) {
    setExpandedGroups(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 p-4 flex flex-col gap-0.5 shrink-0">
        <h1 className="text-lg font-bold text-gray-800 mb-4 px-3">Portfolio Tracker</h1>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item, idx) => {
            if (item.children) {
              const open = expandedGroups[idx]
              const active = isChildActive(item)
              return (
                <div key={idx}>
                  <button
                    onClick={() => toggleGroup(idx)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    <span className={`text-[10px] text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>
                      ▶
                    </span>
                  </button>
                  {open && (
                    <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-gray-200 pl-2">
                      {item.children.map(child => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                              isActive
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                            }`
                          }
                        >
                          <span className="text-xs">{child.icon}</span>
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            )
          })}
        </nav>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  )
}
