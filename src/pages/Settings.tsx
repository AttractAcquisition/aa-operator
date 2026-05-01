import { useState } from 'react'
import { Eye, EyeOff, Check, ExternalLink } from 'lucide-react'
import { Panel, SectionHeader, Button } from '@/components/ui'
import { useAppStore } from '@/store'

function ConfigField({ label, placeholder, envKey, isSecret = false }: {
  label: string; placeholder: string; envKey: string; isSecret?: boolean
}) {
  const [show, setShow] = useState(false)
  const [val, setVal] = useState('')
  const { addNotification } = useAppStore()

  return (
    <div className="flex items-center gap-3 py-3 border-b border-base-700 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium">{label}</p>
        <p className="text-[10px] font-mono text-base-500">{envKey}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="relative">
          <input
            value={val}
            onChange={e => setVal(e.target.value)}
            type={isSecret && !show ? 'password' : 'text'}
            placeholder={placeholder}
            className="w-52 bg-base-750 border border-base-600 rounded px-3 py-1.5 text-xs text-white font-mono placeholder-base-600 focus:outline-none focus:border-electric/60"
          />
          {isSecret && (
            <button
              onClick={() => setShow(!show)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-base-500 hover:text-white"
            >
              {show ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          )}
        </div>
        <Button onClick={() => addNotification(`${label} saved`, 'success')} variant="secondary" size="sm">
          <Check size={12} />
        </Button>
      </div>
    </div>
  )
}

export function Settings() {
  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Settings</h2>
        <p className="text-xs text-base-500 font-mono mt-0.5">API keys, connections, and system configuration</p>
      </div>

      {/* Connection status */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            name: 'Supabase',
            connected: !import.meta.env.VITE_SUPABASE_URL?.includes('placeholder'),
            action: 'fgyvcyksgbivhrqoxkmj',
          },
          {
            name: 'Anthropic API',
            connected: true,
            action: 'Set as Edge Function secret',
          },
          {
            name: 'Meta Ads API',
            connected: false,
            action: 'Add META_ACCESS_TOKEN',
          },
        ].map(({ name, connected, action }) => (
          <Panel key={name} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-op' : 'bg-amber-op'}`} />
              <span className="text-sm text-white font-medium">{name}</span>
            </div>
            <p className={`text-[10px] font-mono uppercase ${connected ? 'text-green-op' : 'text-amber-op'}`}>
              {connected ? 'connected' : 'disconnected'}
            </p>
            <p className="text-[10px] text-base-500 mt-1 font-mono truncate">{action}</p>
          </Panel>
        ))}
      </div>

      {/* Claude Code instruction */}
      <Panel className="p-5 border-electric/20 bg-electric/5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-electric/20 border border-electric/30 flex items-center justify-center flex-shrink-0">
            <span className="text-electric text-sm font-bold">&gt;_</span>
          </div>
          <div>
            <h3 className="font-display font-bold text-white uppercase mb-2">Connect Everything via Claude Code</h3>
            <p className="text-sm text-base-300 mb-3">
              After pushing this project to GitHub, open Claude Code in your terminal and run these commands to connect all services automatically:
            </p>
            <div className="space-y-2">
              {[
                'claude "connect this React app to my Supabase project and set up all required environment variables"',
                'claude "create all the Supabase Edge Functions defined in src/lib/supabase.ts"',
                'claude "create the 5 new database tables: ai_task_log, approval_queue, cron_schedule, knowledge_base, ai_alerts"',
                'claude "set up Vercel cron jobs for all the schedules in src/lib/mockData.ts"',
                'claude "connect the Anthropic API and replace the mock streaming in src/lib/claude.ts with the real Edge Function"',
              ].map((cmd, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded bg-base-850 border border-base-700">
                  <span className="text-electric font-mono text-xs flex-shrink-0">{i + 1}.</span>
                  <code className="text-xs font-mono text-base-300 break-all">{cmd}</code>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* Manual API config */}
      <Panel className="p-4">
        <SectionHeader title="API Keys" action={
          <span className="text-[10px] text-base-500 font-mono">Stored in .env.local — never committed to Git</span>
        } />
        <div>
          <ConfigField label="Supabase URL" placeholder="https://your-project.supabase.co" envKey="VITE_SUPABASE_URL" />
          <ConfigField label="Supabase Anon Key" placeholder="eyJhbGciOiJ..." envKey="VITE_SUPABASE_ANON_KEY" isSecret />
          <ConfigField label="Anthropic API Key" placeholder="sk-ant-..." envKey="ANTHROPIC_API_KEY" isSecret />
          <ConfigField label="Meta Access Token" placeholder="EAABs..." envKey="META_ACCESS_TOKEN" isSecret />
          <ConfigField label="WhatsApp Phone ID" placeholder="1234567890" envKey="WHATSAPP_PHONE_ID" />
          <ConfigField label="Resend API Key" placeholder="re_..." envKey="RESEND_API_KEY" isSecret />
        </div>
      </Panel>

      {/* System preferences */}
      <Panel className="p-4">
        <SectionHeader title="System Preferences" />
        <div className="space-y-3">
          {[
            { label: 'Default Claude Model', value: 'claude-sonnet-4-6', note: 'Used for standard tasks' },
            { label: 'Complex Task Model', value: 'claude-opus-4-6', note: 'Used for MJR, SPOA, reports' },
            { label: 'High-Volume Model', value: 'claude-haiku-4-5', note: 'Used for dedup, classification' },
            { label: 'Timezone', value: 'Europe/London', note: 'Used for cron scheduling' },
            { label: 'Principal Notification Email', value: 'Set your email', note: 'Daily briefing backup' },
          ].map(pref => (
            <div key={pref.label} className="flex items-center gap-3 py-2.5 border-b border-base-700 last:border-0">
              <div className="flex-1">
                <p className="text-sm text-white">{pref.label}</p>
                <p className="text-[10px] text-base-500 font-mono">{pref.note}</p>
              </div>
              <span className="text-xs font-mono text-electric">{pref.value}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Links */}
      <Panel className="p-4">
        <SectionHeader title="Documentation & Resources" />
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Anthropic API Docs', url: 'https://docs.anthropic.com' },
            { label: 'Supabase Edge Functions', url: 'https://supabase.com/docs/guides/functions' },
            { label: 'Vercel Cron Jobs', url: 'https://vercel.com/docs/cron-jobs' },
            { label: 'Build Plan PDF', url: '#' },
          ].map(({ label, url }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 rounded bg-base-750 border border-base-600 hover:border-electric/40 transition-all group"
            >
              <ExternalLink size={12} className="text-base-500 group-hover:text-electric transition-colors" />
              <span className="text-xs text-base-400 group-hover:text-white transition-colors">{label}</span>
            </a>
          ))}
        </div>
      </Panel>
    </div>
  )
}
