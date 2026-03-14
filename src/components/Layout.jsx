import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import {
  BarChart2, Briefcase, DollarSign, ClipboardList, Download,
  Wallet, Camera, LogOut, ChevronRight, Menu, X,
} from 'lucide-react'

const NAV = [
  { to: '/', label: 'Огляд', icon: BarChart2 },
  {
    label: 'Портфелі',
    icon: Briefcase,
    children: [
      { to: '/portfolios', label: 'Портфелі', icon: Briefcase },
      { to: '/dividends', label: 'Дивіденди', icon: DollarSign },
      { to: '/trades', label: 'Угоди', icon: ClipboardList },
      { to: '/import', label: 'Імпорт', icon: Download },
    ],
  },
  { to: '/budget', label: 'Бюджет', icon: Wallet },
  { to: '/snapshots', label: 'Снепшоти', icon: Camera },
]

export default function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const isFetching = useIsFetching()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const isChildActive = (group) =>
    group.children?.some(c => location.pathname === c.to || location.pathname.startsWith(c.to + '/'))

  const [expandedGroups, setExpandedGroups] = useState(() => {
    const open = {}
    NAV.forEach((item, i) => {
      if (item.children && isChildActive(item)) open[i] = true
    })
    return open
  })

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

  const sidebar = (
    <aside className="w-56 glass-sidebar p-4 flex flex-col h-full">
      {/* Brand */}
      <div className="px-3 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-400/25 flex items-center justify-center shrink-0">
            <BarChart2 size={14} className="text-blue-400" />
          </div>
          <span className="text-sm font-bold text-white">Portfolio</span>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-slate-400 hover:text-slate-200 transition-colors p-1"
          aria-label="Закрити меню"
        >
          <X size={16} />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1">
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
                      ? 'text-blue-400'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <item.icon size={16} />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronRight size={12} className={`text-slate-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
                </button>
                {open && (
                  <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-2">
                    {item.children.map(child => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                            isActive
                              ? 'bg-blue-500/15 text-blue-400 font-medium'
                              : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                          }`
                        }
                      >
                        <child.icon size={14} />
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
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {/* User / Sign out */}
      <div className="mt-auto pt-4 border-t border-white/8">
        <p className="text-xs text-slate-500 px-3 mb-2 truncate">{user?.email}</p>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
        >
          <LogOut size={14} />
          Вийти
        </button>
      </div>
    </aside>
  )

  return (
    <div className="min-h-screen flex">
      {/* Global fetch indicator */}
      {isFetching > 0 && (
        <div className="fixed top-0 left-0 right-0 h-0.5 bg-blue-500/20 z-50 overflow-hidden">
          <div className="h-full bg-blue-400 animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
        </div>
      )}

      {/* Desktop sidebar — always visible on lg+ */}
      <div className="hidden lg:flex shrink-0">
        {sidebar}
      </div>

      {/* Mobile sidebar — drawer */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-50 flex lg:hidden">
            {sidebar}
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 glass-sidebar border-b border-white/8">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1"
            aria-label="Відкрити меню"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BarChart2 size={14} className="text-blue-400" />
            <span className="text-sm font-bold text-white">Portfolio</span>
          </div>
        </div>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
