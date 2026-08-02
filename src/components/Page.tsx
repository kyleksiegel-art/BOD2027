import type { ReactNode } from 'react'

/** Standard content column: max-width, gutters, and top/bottom breathing room. */
export function Page({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mx-auto w-full max-w-[720px] px-5 py-6 ${className}`}>
      {children}
    </div>
  )
}
