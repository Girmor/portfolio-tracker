function Skeleton({ className = '', ...props }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/8 ${className}`}
      {...props}
    />
  )
}

export { Skeleton }
