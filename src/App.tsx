import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Chat } from '@/pages/Chat'
import { ApprovalQueue } from '@/pages/ApprovalQueue'
import { CronManager } from '@/pages/CronManager'
import { Sprints } from '@/pages/Sprints'
import { Pipeline } from '@/pages/Pipeline'
import { SOPControl } from '@/pages/SOPControl'
import { Clients } from '@/pages/Clients'
import { Finance } from '@/pages/Finance'
import { Alerts } from '@/pages/Alerts'
import { Settings } from '@/pages/Settings'
import { Documents } from '@/pages/Documents'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      refetchOnWindowFocus: false,
    },
  },
})

const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="approvals" element={<ApprovalQueue />} />
            <Route path="crons" element={<CronManager />} />
            <Route path="sprints" element={<Sprints />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="sops" element={<SOPControl />} />
            <Route path="clients" element={<Clients />} />
            <Route path="finance" element={<Finance />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="documents" element={<Documents />} />
            <Route path="settings" element={<Settings />} />

            <Route
              path="*"
              element={
                <div className="min-h-screen bg-[#0B0F19] p-8 text-white">
                  <h1 className="text-2xl font-semibold">Page not found</h1>
                  <p className="mt-2 text-white/70">
                    No route matched: {window.location.pathname}
                  </p>
                </div>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
