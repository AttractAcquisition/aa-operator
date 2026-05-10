import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-base-950 grid-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-electric/10 border border-electric/30 flex items-center justify-center mb-4">
            <span className="font-display font-bold text-electric text-xl tracking-widest">AA</span>
          </div>
          <h1 className="font-display font-bold text-white text-xl uppercase tracking-wide">
            AA Outreach Command Centre
          </h1>
          <p className="text-xs text-base-500 font-mono mt-1">Attract Acquisition · Operator Portal</p>
        </div>

        {/* Card */}
        <div className="panel p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-base-400 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full bg-base-800 border border-base-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-base-600 focus:outline-none focus:border-electric/50 font-body transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-base-400 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-base-800 border border-base-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-base-600 focus:outline-none focus:border-electric/50 font-body transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-red-op bg-red-op/10 border border-red-op/25 rounded-lg px-3 py-2 font-mono">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-electric/10 hover:bg-electric/20 border border-electric/30 hover:border-electric/50 text-electric font-mono text-sm font-medium rounded-lg px-4 py-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Spinner size={14} /> : null}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-base-700 font-mono mt-6">
          Accounts managed via Supabase Dashboard
        </p>
      </div>
    </div>
  )
}
