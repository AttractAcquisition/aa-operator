import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel injects Authorization: Bearer {CRON_SECRET} on cron invocations.
  // Direct HTTP calls without the secret are rejected.
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const sopId = req.query.sop as string
  if (!sopId) return res.status(400).json({ error: 'Missing ?sop= param' })

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  // Mark as running
  await supabase
    .from('cron_schedule')
    .update({ last_status: 'running', last_run: startedAt })
    .eq('sop_id', sopId)

  try {
    const { data, error } = await supabase.functions.invoke('run-sop', {
      body: { sop_id: sopId },
    })

    if (error) throw error

    const duration_ms = Date.now() - t0
    const sopName: string = data?.sop_name ?? `SOP ${sopId}`

    // Fetch current run_count to compute new average duration
    const { data: schedule } = await supabase
      .from('cron_schedule')
      .select('run_count, avg_duration_ms')
      .eq('sop_id', sopId)
      .single()

    const newCount = (schedule?.run_count ?? 0) + 1
    const prevAvg = schedule?.avg_duration_ms ?? 0
    const newAvg = Math.round((prevAvg * (newCount - 1) + duration_ms) / newCount)

    await Promise.all([
      supabase.from('ai_task_log').insert({
        sop_id: sopId,
        sop_name: sopName,
        tool_called: 'run_sop',
        status: 'success',
        duration_ms,
        input_summary: 'Triggered by Vercel cron',
        output_summary: data?.summary ?? 'Completed successfully',
      }),
      supabase.from('cron_schedule').update({
        last_status: 'success',
        run_count: newCount,
        avg_duration_ms: newAvg,
        last_error: null,
      }).eq('sop_id', sopId),
    ])

    return res.status(200).json({ ok: true, sop_id: sopId, duration_ms, summary: data?.summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const duration_ms = Date.now() - t0

    await Promise.all([
      supabase.from('ai_task_log').insert({
        sop_id: sopId,
        sop_name: `SOP ${sopId}`,
        tool_called: 'run_sop',
        status: 'failure',
        duration_ms,
        input_summary: 'Triggered by Vercel cron',
        output_summary: message,
      }),
      supabase.from('cron_schedule').update({
        last_status: 'failure',
        last_error: message,
      }).eq('sop_id', sopId),
    ])

    return res.status(500).json({ error: message, sop_id: sopId })
  }
}
