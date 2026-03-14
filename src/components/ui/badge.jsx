const variants = {
  default: 'bg-blue-500/15 text-blue-400 border-blue-400/20',
  success: 'bg-green-500/15 text-green-400 border-green-400/20',
  destructive: 'bg-red-500/15 text-red-400 border-red-400/20',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-400/20',
  secondary: 'bg-white/10 text-slate-400 border-white/10',
}

function Badge({ className = '', variant = 'default', children, ...props }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border ${variants[variant] ?? variants.default} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export { Badge }
