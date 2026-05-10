import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { LoginPage } from './LoginPage'
import { Spinner } from '@/components/ui'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-base-950 flex items-center justify-center">
        <Spinner size={32} />
      </div>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  return <>{children}</>
}
