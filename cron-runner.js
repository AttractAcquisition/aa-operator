// Standalone cron runner for Railway.
// Schedules all SOP jobs using node-cron and POSTs to the run-sop Edge Function.
// Run as a separate Railway service alongside the main Express server.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ─── Job definitions ──────────────────────────────────────────────────────────
// Schedules mirror vercel.json. Timezone: Europe/London.

const JOBS = [
  { sop_id: '58', name: 'Admin Command Centre & Daily Review', schedule: '0 5 * * *',  fn: 'sop-58-daily-briefing'  },
  { sop_id: '21', name: 'Proof Sprint Daily Ops',              schedule: '30 6 * * *'  },
  { sop_id: '23', name: 'Proof Sprint Ads Monitoring',         schedule: '0 7 * * *'   },
  { sop_id: '06', name: 'Reply Triage & CRM Hygiene',          schedule: '30 7 * * *'  },
  { sop_id: '01', name: 'WhatsApp Outreach Draft Queue',       schedule: '0 8 * * 1-5' },
  { sop_id: '47', name: 'Weekly Client Reporting',             schedule: '0 17 * * 5'  },
  { sop_id: '51', name: 'Admin Check',                         schedule: '30 6 * * 1', fn: 'sop-51-admin-check'       },
  { sop_id: '56', name: 'Finance Dashboard & Income Tracking', schedule: '0 6 * * 1',  fn: 'sop-56-finance-dashboard' },
  { sop_id: '52', name: 'Backup & Security Check',             schedule: '0 1 * * 0',  fn: 'sop-52-backup-check'     },
  { sop_id: '02', name: 'Prospect Scraper & Batch Run',        schedule: '0 8 * * 1',  fn: 'sop-02-prospect-scraper' },
  { sop_id: '31', name: 'Proof Brand Ops',                     schedule: '0 9 1 * *'   },
  { sop_id: '33', name: 'SOP Versioning',                      schedule: '0 11 1 * *', fn: 'sop-33-sop-versioning'   },
  { sop_id: '43', name: 'Authority Brand Ops',                 schedule: '0 10 1 * *'  },
  { sop_id: '35', name: 'Upsell Detection',                    schedule: '0 9 * * 1'   },
  { sop_id: '26', name: 'Sprint Closeout',                     schedule: '0 7 * * *',  fn: 'sop-26-sprint-closeout'  },
  { sop_id: '41', name: 'Weekly Review',                       schedule: '0 16 * * 5', fn: 'sop-41-weekly-review'    },
  { sop_id: '46', name: 'Billing & Payment Chase',             schedule: '30 8 * * 1', fn: 'sop-46-billing'          },
  { sop_id: '53', name: 'Monthly KPI Review',                 schedule: '0 8 1 * *',  fn: 'sop-53-kpi-review'       },
]

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runSop(sop_id, sop_name, fn) {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  console.log(`[${startedAt}] Starting SOP ${sop_id} — ${sop_name}`)

  await supabase
    .from('cron_schedule')
    .update({ last_status: 'running', last_run: startedAt })
    .eq('sop_id', sop_id)

  try {
    const { data, error } = fn
      ? await supabase.functions.invoke(fn, { body: {} })
      : await supabase.functions.invoke('run-sop', { body: { sop_id } })
    if (error) throw error

    const duration_ms = Date.now() - t0

    const { data: schedule } = await supabase
      .from('cron_schedule')
      .select('run_count, avg_duration_ms')
      .eq('sop_id', sop_id)
      .single()

    const newCount = (schedule?.run_count ?? 0) + 1
    const prevAvg = schedule?.avg_duration_ms ?? 0
    const newAvg = Math.round((prevAvg * (newCount - 1) + duration_ms) / newCount)

    await Promise.all([
      supabase.from('ai_task_log').insert({
        sop_id,
        sop_name: data?.sop_name ?? sop_name,
        tool_called: 'run_sop',
        status: 'success',
        duration_ms,
        input_summary: 'Triggered by Railway cron',
        output_summary: data?.summary ?? 'Completed successfully',
      }),
      supabase.from('cron_schedule').update({
        last_status: 'success',
        run_count: newCount,
        avg_duration_ms: newAvg,
        last_error: null,
      }).eq('sop_id', sop_id),
    ])

    console.log(`[${new Date().toISOString()}] SOP ${sop_id} completed in ${duration_ms}ms`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const duration_ms = Date.now() - t0

    await Promise.all([
      supabase.from('ai_task_log').insert({
        sop_id,
        sop_name,
        tool_called: 'run_sop',
        status: 'failure',
        duration_ms,
        input_summary: 'Triggered by Railway cron',
        output_summary: message,
      }),
      supabase.from('cron_schedule').update({
        last_status: 'failure',
        last_error: message,
      }).eq('sop_id', sop_id),
      supabase.from('ai_alerts').insert({
        severity: 'critical',
        category: 'Cron Failure',
        sop_id,
        message: `SOP ${sop_id} — ${sop_name} failed: ${message}`,
        suggested_action: 'Check Railway cron service logs and redeploy Edge Function if needed',
        resolved: false,
      }),
    ])

    console.error(`[${new Date().toISOString()}] SOP ${sop_id} FAILED: ${message}`)
  }
}

// ─── Schedule all jobs ────────────────────────────────────────────────────────

for (const job of JOBS) {
  cron.schedule(job.schedule, () => runSop(job.sop_id, job.name, job.fn), {
    timezone: 'Europe/London',
  })
  console.log(`Scheduled SOP ${job.sop_id} (${job.name}) — ${job.schedule}`)
}

console.log(`AA Operator cron runner started — ${JOBS.length} jobs scheduled`)

setInterval(() => {
  console.log(`[${new Date().toISOString()}] Heartbeat — ${JOBS.length} jobs active`)
}, 60 * 60 * 1000)

// ─── Global crash handler ─────────────────────────────────────────────────────

process.on('uncaughtException', async (err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[${new Date().toISOString()}] Uncaught exception — cron runner crashing: ${message}`)
  try {
    await supabase.from('ai_alerts').insert({
      severity: 'critical',
      category: 'Cron Failure',
      message: `Cron runner process crashed: ${message}`,
      suggested_action: 'Check Railway cron service logs and redeploy Edge Function if needed',
      resolved: false,
    })
  } catch (alertErr) {
    console.error('Failed to write crash alert to Supabase:', alertErr)
  }
  process.exit(1)
})
