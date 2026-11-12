import React from 'react'
import { getValidatedAppSession } from '@/lib/auth-server'
import { redirect } from 'next/navigation'
import { SettingsClient } from '@/components/settings/SettingsClient'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const t0 = performance.now()
  const session = await getValidatedAppSession()

  if (!session.isLoggedIn) {
    redirect('/login')
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] SettingsPage render: ${(performance.now() - t0).toFixed(1)}ms`)
  }

  return <SettingsClient initialRole={session.role} />
}
