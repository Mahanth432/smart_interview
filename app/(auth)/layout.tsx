import React from 'react'
import { redirect } from 'next/navigation'

import { getValidatedAppSession } from '@/lib/auth-server'
import { AppShell } from '@/components/AppShell'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const t0 = performance.now()
  const session = await getValidatedAppSession()

  if (!session.isLoggedIn) {
    redirect('/login')
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] AuthLayout render: ${(performance.now() - t0).toFixed(1)}ms`)
  }

  return (
    <AppShell username={session.username} role={session.role}>
      {children}
    </AppShell>
  )
}
