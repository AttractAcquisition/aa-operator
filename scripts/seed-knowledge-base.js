#!/usr/bin/env node
// Upserts the MJR HTML template into the knowledge_base table.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-knowledge-base.js

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── MJR HTML Template ─────────────────────────────────────────────────────────
// Placeholders filled by SOP-08 via Claude:
//   {{prospect_name}}         — tradesman's full name
//   {{company_name}}          — their trading name
//   {{niche}}                 — trade type (e.g. "plumber", "electrician")
//   {{local_area}}            — their city/town
//   {{estimated_missed_jobs}} — estimated jobs lost per month
//   {{competitor_count}}      — number of active local competitors
//   {{avg_competitor_reviews}}— average Google review count per competitor
//   {{key_competitors}}       — comma-separated list of named competitors
//   {{local_insights}}        — 2–3 sentence market commentary

const MJR_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Missed Jobs Report — {{company_name}}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f4f5f7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a2e;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper { max-width: 680px; margin: 0 auto; padding: 32px 16px 64px; }

    /* Header */
    .header {
      background: #1a1a2e;
      border-radius: 12px 12px 0 0;
      padding: 28px 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand { color: #ffffff; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
    .brand span { color: #f97316; }
    .report-badge {
      background: #f97316;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 5px 12px;
      border-radius: 20px;
    }

    /* Hero */
    .hero {
      background: #ffffff;
      padding: 40px 36px 32px;
      border-left: 1px solid #e8eaed;
      border-right: 1px solid #e8eaed;
    }
    .hero-eyebrow {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #f97316;
      margin-bottom: 12px;
    }
    .hero h1 {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.25;
      color: #1a1a2e;
      margin-bottom: 16px;
    }
    .hero h1 .highlight { color: #f97316; }
    .hero p {
      font-size: 15px;
      line-height: 1.7;
      color: #4b5563;
    }

    /* Stat cards */
    .stats-grid {
      background: #1a1a2e;
      padding: 28px 36px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .stat-card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 20px;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 36px;
      font-weight: 800;
      color: #f97316;
      line-height: 1;
      margin-bottom: 4px;
    }
    .stat-sub { font-size: 12px; color: #6b7280; }

    /* Section cards */
    .section {
      background: #ffffff;
      border: 1px solid #e8eaed;
      border-top: none;
      padding: 32px 36px;
    }
    .section + .section { border-top: 1px solid #e8eaed; }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 16px;
    }
    .section h2 {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 12px;
    }
    .section p {
      font-size: 14px;
      line-height: 1.75;
      color: #4b5563;
    }

    /* Competitor list */
    .competitor-list {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .competitor-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #f9fafb;
      border: 1px solid #e8eaed;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .competitor-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f97316;
      flex-shrink: 0;
    }
    .competitor-name {
      font-size: 14px;
      font-weight: 600;
      color: #1a1a2e;
      flex: 1;
    }
    .competitor-tag {
      font-size: 11px;
      font-weight: 600;
      color: #6b7280;
      background: #e5e7eb;
      padding: 3px 8px;
      border-radius: 4px;
    }

    /* Revenue impact callout */
    .impact-box {
      background: #fff7ed;
      border: 2px solid #fed7aa;
      border-radius: 10px;
      padding: 24px;
      margin-top: 20px;
    }
    .impact-box .impact-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #ea580c;
      margin-bottom: 8px;
    }
    .impact-box .impact-value {
      font-size: 28px;
      font-weight: 800;
      color: #c2410c;
      margin-bottom: 4px;
    }
    .impact-box .impact-note {
      font-size: 13px;
      color: #9a3412;
    }

    /* Insight section */
    .insight-block {
      border-left: 3px solid #f97316;
      padding-left: 16px;
      margin-top: 16px;
    }
    .insight-block p {
      font-size: 14px;
      line-height: 1.75;
      color: #374151;
      font-style: italic;
    }

    /* CTA section */
    .cta-section {
      background: #1a1a2e;
      border-radius: 0 0 12px 12px;
      padding: 36px;
      text-align: center;
    }
    .cta-section h2 {
      font-size: 20px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 10px;
    }
    .cta-section p {
      font-size: 14px;
      color: #9ca3af;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .cta-btn {
      display: inline-block;
      background: #f97316;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      letter-spacing: 0.01em;
    }
    .cta-footnote {
      margin-top: 16px;
      font-size: 12px;
      color: #6b7280;
    }

    /* Footer */
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 11px;
      color: #9ca3af;
      line-height: 1.8;
    }

    @media (max-width: 480px) {
      .header { padding: 20px; flex-direction: column; gap: 12px; text-align: center; }
      .hero, .section, .cta-section { padding: 24px 20px; }
      .stats-grid { padding: 20px; grid-template-columns: 1fr; }
      .stat-value { font-size: 28px; }
    }
  </style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header">
    <div class="brand">Attract <span>Acquisition</span></div>
    <div class="report-badge">Missed Jobs Report</div>
  </div>

  <!-- Hero -->
  <div class="hero">
    <div class="hero-eyebrow">Personalised for {{company_name}}</div>
    <h1>Hi {{prospect_name}}, here's how many jobs you're <span class="highlight">missing every month</span>.</h1>
    <p>
      We analysed the {{niche}} market in <strong>{{local_area}}</strong> and found
      something worth your attention. Local competitors are picking up jobs that
      could be yours — and the numbers below show exactly how big that gap is.
    </p>
  </div>

  <!-- Key stats -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Est. Missed Jobs / Month</div>
      <div class="stat-value">{{estimated_missed_jobs}}</div>
      <div class="stat-sub">jobs going to competitors</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active Local Competitors</div>
      <div class="stat-value">{{competitor_count}}</div>
      <div class="stat-sub">{{niche}} businesses in {{local_area}}</div>
    </div>
  </div>

  <!-- Competitor landscape -->
  <div class="section">
    <div class="section-title">Competitor Landscape</div>
    <h2>Who's taking your calls in {{local_area}}</h2>
    <p>
      We identified <strong>{{competitor_count}} active {{niche}} businesses</strong>
      operating in your area, with an average of
      <strong>{{avg_competitor_reviews}} Google reviews</strong> each.
      Review count is one of the strongest trust signals for local buyers —
      the more reviews a business has, the higher it ranks and the more calls it gets.
    </p>

    <div class="competitor-list">
      {{key_competitors}}
    </div>
  </div>

  <!-- Revenue impact -->
  <div class="section">
    <div class="section-title">Revenue Impact</div>
    <h2>What those missed jobs are really worth</h2>
    <p>
      Every missed job is lost revenue. Based on typical job values for a {{niche}}
      business in {{local_area}}, the opportunity gap runs well into five figures
      per year — and it compounds as competitors build more reviews and outrank you further.
    </p>

    <div class="impact-box">
      <div class="impact-label">Estimated Monthly Revenue Lost</div>
      <div class="impact-value">{{estimated_missed_jobs}} jobs × avg. job value</div>
      <div class="impact-note">
        Even at a conservative average job value, {{estimated_missed_jobs}} missed
        jobs per month adds up fast — and this only counts the leads you never see.
      </div>
    </div>
  </div>

  <!-- Local insights -->
  <div class="section">
    <div class="section-title">Local Market Intelligence</div>
    <h2>What we're seeing on the ground in {{local_area}}</h2>
    <div class="insight-block">
      <p>{{local_insights}}</p>
    </div>
    <p style="margin-top:16px;">
      The good news: most of your competitors are winning on volume of reviews alone,
      not superior service. That's a gap you can close quickly — and once you do,
      the inbound leads follow predictably.
    </p>
  </div>

  <!-- CTA -->
  <div class="cta-section">
    <h2>Ready to stop missing jobs?</h2>
    <p>
      We help {{niche}} businesses in {{local_area}} turn their reputation into a
      lead-generation machine — without paid ads or chasing referrals. Book a free
      15-minute strategy call and we'll show you exactly what we'd do for
      {{company_name}}.
    </p>
    <a class="cta-btn" href="https://attractacquisition.com/call">Book Your Free Call</a>
    <div class="cta-footnote">No pitch. No pressure. Just a straight conversation about your numbers.</div>
  </div>

</div>

<div class="footer">
  This report was prepared exclusively for {{prospect_name}} at {{company_name}}.<br />
  Attract Acquisition · attractacquisition.com<br />
  <span style="color:#d1d5db;">To unsubscribe, reply with "remove" to this email.</span>
</div>

</body>
</html>`

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding knowledge_base with MJR template…')

  // Remove any stale mjr_template rows before inserting fresh
  const { error: delError } = await supabase
    .from('knowledge_base')
    .delete()
    .eq('type', 'template')
    .contains('tags', ['mjr_template'])

  if (delError) {
    console.error('Failed to clear existing MJR template rows:', delError.message)
    process.exit(1)
  }

  const { data, error } = await supabase
    .from('knowledge_base')
    .insert({
      type: 'template',
      title: 'Missed Jobs Report (MJR) Template',
      content: MJR_TEMPLATE,
      tags: ['mjr_template'],
      is_active: true,
      metadata: { key: 'mjr_template' },
    })
    .select('id, title')
    .single()

  if (error) {
    console.error('Insert failed:', error.message)
    process.exit(1)
  }

  console.log(`✓ Inserted MJR template  id=${data.id}  title="${data.title}"`)
}

seed()
