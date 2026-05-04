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

// ── SPOA HTML Template ────────────────────────────────────────────────────────
// Placeholders filled by SOP-12 via Claude:
//   {{prospect_name}}             — tradesman's full name
//   {{company_name}}              — their trading name
//   {{niche}}                     — trade type (e.g. "plumber", "electrician")
//   {{local_area}}                — their city/town
//   {{recommended_tier}}          — Proof Sprint | Proof Brand | Authority Brand
//   {{monthly_investment}}        — monthly management fee (e.g. "£1,497")
//   {{expected_leads_per_month}}  — projected lead volume (e.g. "15–25 qualified enquiries")
//   {{expected_cpl}}              — cost per lead range (e.g. "£35–60")
//   {{competitor_analysis}}       — HTML snippet or text block of competitor findings
//   {{campaign_strategy}}         — recommended channels, campaign types, and rationale
//   {{timeline}}                  — implementation timeline (HTML rows or text)
//   {{roi_projection}}            — ROI narrative and numbers

const SPOA_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Strategic Plan of Action — {{company_name}}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f4f5f7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a2e;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper { max-width: 680px; margin: 0 auto; padding: 32px 16px 64px; }

    /* ── Header ── */
    .header {
      background: #1a1a2e;
      border-radius: 12px 12px 0 0;
      padding: 28px 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand { color: #fff; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
    .brand span { color: #f97316; }
    .doc-badge {
      background: #f97316;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 5px 12px;
      border-radius: 20px;
    }

    /* ── Hero ── */
    .hero {
      background: #fff;
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
    .hero p { font-size: 15px; line-height: 1.7; color: #4b5563; }

    /* ── Summary stats bar ── */
    .stats-bar {
      background: #1a1a2e;
      padding: 24px 36px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }
    .stat-item { text-align: center; }
    .stat-item .s-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 6px;
    }
    .stat-item .s-value {
      font-size: 22px;
      font-weight: 800;
      color: #f97316;
      line-height: 1.1;
    }
    .stat-item .s-sub { font-size: 11px; color: #6b7280; margin-top: 3px; }

    /* ── Sections ── */
    .section {
      background: #fff;
      border: 1px solid #e8eaed;
      border-top: none;
      padding: 32px 36px;
    }
    .section + .section { border-top: 1px solid #e8eaed; }
    .section-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 8px;
    }
    .section h2 {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 14px;
    }
    .section p { font-size: 14px; line-height: 1.75; color: #4b5563; }
    .section p + p { margin-top: 10px; }

    /* ── Tier badge ── */
    .tier-badge {
      display: inline-block;
      background: #fff7ed;
      border: 1.5px solid #fed7aa;
      color: #c2410c;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 5px 14px;
      border-radius: 20px;
      margin-bottom: 20px;
    }

    /* ── Investment box ── */
    .investment-grid {
      margin-top: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .inv-card {
      background: #f9fafb;
      border: 1px solid #e8eaed;
      border-radius: 10px;
      padding: 16px 20px;
    }
    .inv-card .inv-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 8px;
    }
    .inv-card .inv-value {
      font-size: 24px;
      font-weight: 800;
      color: #1a1a2e;
      line-height: 1;
    }
    .inv-card .inv-sub { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .inv-card.accent { background: #fff7ed; border-color: #fed7aa; }
    .inv-card.accent .inv-value { color: #c2410c; }

    /* ── Competitor analysis block ── */
    .competitor-block {
      margin-top: 16px;
      background: #f9fafb;
      border: 1px solid #e8eaed;
      border-radius: 10px;
      padding: 20px;
      font-size: 14px;
      line-height: 1.75;
      color: #4b5563;
    }

    /* ── Strategy pills ── */
    .strategy-content {
      margin-top: 16px;
      font-size: 14px;
      line-height: 1.75;
      color: #4b5563;
    }

    /* ── Timeline table ── */
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
      font-size: 13px;
    }
    .timeline-table th {
      background: #1a1a2e;
      color: #9ca3af;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 10px 14px;
      text-align: left;
    }
    .timeline-table th:first-child { border-radius: 8px 0 0 0; }
    .timeline-table th:last-child  { border-radius: 0 8px 0 0; }
    .timeline-table td {
      padding: 11px 14px;
      border-bottom: 1px solid #e8eaed;
      color: #374151;
      vertical-align: top;
    }
    .timeline-table tr:last-child td { border-bottom: none; }
    .timeline-table tr:nth-child(even) td { background: #f9fafb; }
    .timeline-table .phase-badge {
      display: inline-block;
      background: #f97316;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      white-space: nowrap;
    }

    /* ── ROI callout ── */
    .roi-box {
      background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
      border: 2px solid #fed7aa;
      border-radius: 10px;
      padding: 24px;
      margin-top: 20px;
    }
    .roi-box .roi-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #ea580c;
      margin-bottom: 10px;
    }
    .roi-box .roi-body {
      font-size: 14px;
      line-height: 1.75;
      color: #9a3412;
    }

    /* ── Insight quote ── */
    .insight-block {
      border-left: 3px solid #f97316;
      padding-left: 16px;
      margin-top: 16px;
    }
    .insight-block p { font-size: 14px; line-height: 1.75; color: #374151; font-style: italic; }

    /* ── CTA ── */
    .cta-section {
      background: #1a1a2e;
      border-radius: 0 0 12px 12px;
      padding: 36px;
      text-align: center;
    }
    .cta-section h2 { font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 10px; }
    .cta-section p { font-size: 14px; color: #9ca3af; margin-bottom: 24px; line-height: 1.6; }
    .cta-btn {
      display: inline-block;
      background: #f97316;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      letter-spacing: 0.01em;
    }
    .cta-footnote { margin-top: 16px; font-size: 12px; color: #6b7280; }

    /* ── Footer ── */
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
      .stats-bar { padding: 20px; grid-template-columns: 1fr; }
      .investment-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<div class="wrapper">

  <!-- ── Header ── -->
  <div class="header">
    <div class="brand">Attract <span>Acquisition</span></div>
    <div class="doc-badge">Strategic Plan of Action</div>
  </div>

  <!-- ── Hero ── -->
  <div class="hero">
    <div class="hero-eyebrow">Prepared exclusively for {{company_name}}</div>
    <h1>{{prospect_name}}, here is your <span class="highlight">personalised growth plan</span> for {{local_area}}.</h1>
    <p>
      Based on our research into the <strong>{{niche}} market in {{local_area}}</strong>,
      we've built a strategy tailored to where your business is right now and where
      it can realistically be in 90 days. Everything below is specific to you —
      not a generic pitch deck.
    </p>
  </div>

  <!-- ── Summary stats ── -->
  <div class="stats-bar">
    <div class="stat-item">
      <div class="s-label">Monthly Investment</div>
      <div class="s-value">{{monthly_investment}}</div>
      <div class="s-sub">management fee</div>
    </div>
    <div class="stat-item">
      <div class="s-label">Expected Leads / Month</div>
      <div class="s-value">{{expected_leads_per_month}}</div>
      <div class="s-sub">qualified enquiries</div>
    </div>
    <div class="stat-item">
      <div class="s-label">Target Cost Per Lead</div>
      <div class="s-value">{{expected_cpl}}</div>
      <div class="s-sub">per qualified lead</div>
    </div>
  </div>

  <!-- ── Recommended package ── -->
  <div class="section">
    <div class="section-eyebrow">Recommended Package</div>
    <h2>What we're proposing for {{company_name}}</h2>
    <div class="tier-badge">{{recommended_tier}}</div>
    <p>
      After researching your business and the competitive landscape in
      <strong>{{local_area}}</strong>, we're recommending the
      <strong>{{recommended_tier}}</strong> package. This is designed for
      {{niche}} businesses at your stage — it gives you a consistent, measurable
      pipeline without overcommitting budget before we've proven the numbers.
    </p>
    <div class="investment-grid">
      <div class="inv-card accent">
        <div class="inv-label">Monthly Management Fee</div>
        <div class="inv-value">{{monthly_investment}}</div>
        <div class="inv-sub">per month, no lock-in after minimum</div>
      </div>
      <div class="inv-card">
        <div class="inv-label">Expected Leads / Month</div>
        <div class="inv-value">{{expected_leads_per_month}}</div>
        <div class="inv-sub">qualified phone enquiries or form fills</div>
      </div>
      <div class="inv-card">
        <div class="inv-label">Target CPL</div>
        <div class="inv-value">{{expected_cpl}}</div>
        <div class="inv-sub">cost per qualified lead</div>
      </div>
      <div class="inv-card">
        <div class="inv-label">Channels</div>
        <div class="inv-value" style="font-size:14px;font-weight:700;padding-top:4px;">Google + Meta</div>
        <div class="inv-sub">dual-channel from day one</div>
      </div>
    </div>
  </div>

  <!-- ── Competitor analysis ── -->
  <div class="section">
    <div class="section-eyebrow">Market Intelligence</div>
    <h2>The competitive landscape in {{local_area}}</h2>
    <p>
      Understanding who you're up against — and where they're weak — is the
      foundation of a strategy that works. Here's what we found in your market.
    </p>
    <div class="competitor-block">
      {{competitor_analysis}}
    </div>
  </div>

  <!-- ── Campaign strategy ── -->
  <div class="section">
    <div class="section-eyebrow">Campaign Strategy</div>
    <h2>How we'll generate leads for {{company_name}}</h2>
    <p>
      Every strategy we build is channel-specific and niche-specific.
      For a <strong>{{niche}} business in {{local_area}}</strong>, here's
      the approach that gives you the fastest return on investment.
    </p>
    <div class="strategy-content">
      {{campaign_strategy}}
    </div>
  </div>

  <!-- ── ROI projection ── -->
  <div class="section">
    <div class="section-eyebrow">Return on Investment</div>
    <h2>What the numbers look like for {{company_name}}</h2>
    <p>
      We project every engagement conservatively — we'd rather under-promise
      and over-deliver. The figures below are based on typical performance
      for a <strong>{{niche}}</strong> running paid ads in a market like
      <strong>{{local_area}}</strong>.
    </p>
    <div class="roi-box">
      <div class="roi-label">Projected ROI — Month 3</div>
      <div class="roi-body">{{roi_projection}}</div>
    </div>
  </div>

  <!-- ── Implementation timeline ── -->
  <div class="section">
    <div class="section-eyebrow">Implementation Timeline</div>
    <h2>What happens and when</h2>
    <p>
      From the moment you say go, here's exactly how the first 60 days unfold
      so there are no surprises.
    </p>
    <table class="timeline-table">
      <thead>
        <tr>
          <th>Phase</th>
          <th>Timeframe</th>
          <th>What Happens</th>
        </tr>
      </thead>
      <tbody>
        {{timeline}}
      </tbody>
    </table>
  </div>

  <!-- ── Why Attract Acquisition ── -->
  <div class="section">
    <div class="section-eyebrow">Why Us</div>
    <h2>Why {{niche}} businesses choose Attract Acquisition</h2>
    <div class="insight-block">
      <p>
        We work exclusively with local service businesses. We don't run campaigns
        for e-commerce brands or SaaS companies — which means every pound of
        experience we have is relevant to your exact situation. When we say we
        understand the <strong>{{niche}} market in {{local_area}}</strong>,
        we mean it.
      </p>
    </div>
    <p style="margin-top:16px;">
      We operate on a simple principle: if the ads don't work, we don't deserve
      to keep your money. That's why every engagement starts with a clearly
      defined performance target — and we report on it every week.
    </p>
  </div>

  <!-- ── CTA ── -->
  <div class="cta-section">
    <h2>Let's make this plan a reality.</h2>
    <p>
      Everything in this document is ready to activate for {{company_name}}.
      The only thing missing is your go-ahead. Book a 20-minute call and
      we'll walk through the strategy together, answer any questions,
      and confirm a start date.
    </p>
    <a class="cta-btn" href="https://attractacquisition.com/call">Book Your Strategy Call</a>
    <div class="cta-footnote">No obligation. Cancel or pause any time after the minimum term.</div>
  </div>

</div>

<div class="footer">
  This Strategic Plan of Action was prepared exclusively for {{prospect_name}} at {{company_name}}.<br />
  Attract Acquisition · attractacquisition.com<br />
  <span style="color:#d1d5db;">To unsubscribe, reply "remove" and we'll take you off our list immediately.</span>
</div>

</body>
</html>`

// ── Seed ──────────────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    key: 'mjr_template',
    title: 'Missed Jobs Report (MJR) Template',
    content: MJR_TEMPLATE,
    tags: ['mjr_template'],
  },
  {
    key: 'spoa_template',
    title: 'Strategic Plan of Action (SPOA) Template',
    content: SPOA_TEMPLATE,
    tags: ['spoa_template'],
  },
]

async function seed() {
  console.log(`Seeding knowledge_base with ${TEMPLATES.length} templates…\n`)

  for (const tpl of TEMPLATES) {
    // Remove stale rows for this tag before inserting fresh
    const { error: delError } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('type', 'template')
      .contains('tags', [tpl.key])

    if (delError) {
      console.error(`✗ Failed to clear existing ${tpl.key} rows:`, delError.message)
      process.exit(1)
    }

    const { data, error } = await supabase
      .from('knowledge_base')
      .insert({
        type: 'template',
        title: tpl.title,
        content: tpl.content,
        tags: tpl.tags,
        is_active: true,
        metadata: { key: tpl.key },
      })
      .select('id, title')
      .single()

    if (error) {
      console.error(`✗ Insert failed for ${tpl.key}:`, error.message)
      process.exit(1)
    }

    console.log(`✓ ${data.title}`)
    console.log(`  id=${data.id}  key=${tpl.key}\n`)
  }

  console.log('Done.')
}

seed()
