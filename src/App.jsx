// =============================================================
// REQUIRED SUPABASE COLUMNS:
//   event_vendors:  coordinator_tier (text)
//   delays:         submitted_at (timestamptz, default now())
//                   completed_at (timestamptz)
//                   actual_mins  (integer)
//                   reconciliation_status (text, default 'open')
//
// SQL to run in Supabase SQL editor if not already done:
//   ALTER TABLE event_vendors ADD COLUMN IF NOT EXISTS coordinator_tier TEXT;
//   ALTER TABLE delays ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NOW();
//   ALTER TABLE delays ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
//   ALTER TABLE delays ADD COLUMN IF NOT EXISTS actual_mins INTEGER;
//   ALTER TABLE delays ADD COLUMN IF NOT EXISTS reconciliation_status TEXT DEFAULT 'open';
// =============================================================

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "./supabase"
import { useSearchParams } from 'react-router-dom'

const STATUS_OPTIONS = [
  { label: "Drafting",  color: "#fbbf24" },
  { label: "Reviewing", color: "#60a5fa" },
  { label: "Revisions", color: "#f87171" },
  { label: "Approved",  color: "#34d399" },
  { label: "Published", color: "#7c3aed" },
  { label: "Live",      color: "#34d399" },
  { label: "Completed", color: "#94a3b8" },
  { label: "Archived",  color: "#6b7280" },
]

const PHASE_COLORS = [
  { label: "Purple", value: "#c084fc" },
  { label: "Blue",   value: "#60a5fa" },
  { label: "Green",  value: "#34d399" },
  { label: "Amber",  value: "#fbbf24" },
  { label: "Pink",   value: "#f472b6" },
  { label: "Orange", value: "#fb923c" },
]

const VENDOR_ROLES = [
  { key: "coordinator", label: "Coordinator", color: "#7c3aed" },
  { key: "mc",          label: "MC",          color: "#b45309" },
  { key: "dj",          label: "DJ",          color: "#6d28d9" },
  { key: "livemusic",   label: "Live Music",  color: "#c2410c" },
  { key: "liveband",    label: "Live Band",   color: "#ea580c" },
  { key: "catering",    label: "Catering",    color: "#0f766e" },
  { key: "staffing",    label: "Staffing",    color: "#0369a1" },
  { key: "photography", label: "Photography", color: "#1d4ed8" },
  { key: "videography", label: "Videography", color: "#047857" },
  { key: "decor",       label: "Decor",       color: "#be185d" },
  { key: "venue",       label: "Venue",       color: "#374151" },
]

const COORDINATOR_TIERS = [
  { key: "lead",      label: "Lead Coordinator",      color: "#7c3aed" },
  { key: "assistant", label: "Assistant Coordinator", color: "#60a5fa" },
]

const ITEM_STATUSES = [
  { key: "upcoming",   label: "Upcoming",    color: "#4b5563", emoji: "⏳" },
  { key: "inprogress", label: "In Progress", color: "#fbbf24", emoji: "▶" },
  { key: "completed",  label: "Completed",   color: "#34d399", emoji: "✅" },
  { key: "early",      label: "Early! 😊",   color: "#34d399", emoji: "😊" },
  { key: "delayed",    label: "Delayed",     color: "#f87171", emoji: "⏱" },
  { key: "skipped",    label: "Skipped",     color: "#64748b", emoji: "⏭" },
]

// ── HELPERS ───────────────────────────────────────────────────
function parseTimeToMins(t) {
  if (!t) return 0
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1]), mn = parseInt(m[2])
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0
  return h * 60 + mn
}

function formatMins(totalMins) {
  const h = Math.floor(totalMins / 60), m = totalMins % 60
  const mer = h >= 12 ? "PM" : "AM"
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${dh}:${String(m).padStart(2, "0")} ${mer}`
}

function fmtTimestamp(iso) {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function nowInMins() {
  const n = new Date()
  return n.getHours() * 60 + n.getMinutes()
}

function currentTimeStr() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// Permission helpers — read coordinatorTier from vendor object
function isLead(vendor)      { return vendor?.role === "coordinator" && vendor?.coordinatorTier === "lead" }
function isAssistant(vendor) { return vendor?.role === "coordinator" && vendor?.coordinatorTier === "assistant" }
function isCoord(vendor)     { return vendor?.role === "coordinator" }

// ── LIVE CLOCK ────────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState(currentTimeStr())
  useEffect(() => {
    // Update every 10s so "now" highlighting stays in sync
    const id = setInterval(() => setTime(currentTimeStr()), 10000)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)",
      borderRadius: 24, padding: "8px 20px"
    }}>
      <span style={{ fontSize: 18 }}>🕐</span>
      <span style={{ color: "#7c3aed", fontSize: 20, fontFamily: "Georgia", fontWeight: 700, letterSpacing: 1 }}>{time}</span>
    </div>
  )
}

// ── HEALTH TRACKER ────────────────────────────────────────────
function HealthTracker({ runningDelay, skippedCount }) {
  let emoji = "😊", label = "On Track", color = "#34d399"
  if (runningDelay >= 15 || skippedCount > 1) { emoji = "😢"; label = `Behind ${runningDelay}min`; color = "#f87171" }
  else if (runningDelay >= 1 || skippedCount === 1) { emoji = "😐"; label = `Slight delay ${runningDelay}min`; color = "#fbbf24" }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: `${color}10`, border: `1.5px solid ${color}40`, borderRadius: 20, padding: "4px 12px" }}>
      <span style={{ fontSize: 16 }}>{emoji}</span>
      <span style={{ color, fontSize: 11, fontFamily: "Georgia", letterSpacing: 1 }}>{label}</span>
    </div>
  )
}

// ── STATUS TAG ────────────────────────────────────────────────
function StatusTag({ status, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = STATUS_OPTIONS.find(s => s.label === status)

  useEffect(() => {
    if (!open) return
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    // Use setTimeout to avoid the same click that opened the menu from closing it
    const timer = setTimeout(() => document.addEventListener("mousedown", h), 0)
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", h) }
  }, [open])

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        style={{ background: `${current?.color}18`, border: `1px solid ${current?.color}50`, borderRadius: 20, padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: current?.color }} />
        <span style={{ color: current?.color, fontSize: 10, fontFamily: "Georgia", letterSpacing: 2 }}>{status}</span>
        <span style={{ color: current?.color, fontSize: 9 }}>▼</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: 30, left: 0, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 8, zIndex: 100, minWidth: 150, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
          {STATUS_OPTIONS.map(opt => (
            <div key={opt.label} onClick={(e) => { e.stopPropagation(); onChange(opt.label); setOpen(false) }}
              style={{ padding: "7px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = `${opt.color}12`}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: opt.color }} />
              <span style={{ color: opt.color, fontSize: 12, fontFamily: "Georgia" }}>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── EVENT CARD ────────────────────────────────────────────────
function EventCard({ event, onStatusChange, onClick }) {
  return (
    <div onClick={onClick}
      style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, cursor: "pointer", transition: "border-color 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#c084fc40"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#e5e7eb"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 16, margin: "0 0 4px" }}>{event.event_name}</h3>
          <p style={{ color: "#7c3aed", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{event.client_name}</p>
        </div>
        <StatusTag status={event.status} onChange={(s) => onStatusChange(event.id, s)} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{event.event_date} · {event.venue}</p>
        {event.hashtag && <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{event.hashtag}</p>}
      </div>
    </div>
  )
}

// ── SUB EVENT CARD ────────────────────────────────────────────
function SubEventCard({ sub, onClick, onDelete }) {
  return (
    <div style={{ background: "#ffffff", border: `1.5px solid ${sub.color}40`, borderRadius: 10, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "border-color 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = `${sub.color}70`}
      onMouseLeave={e => e.currentTarget.style.borderColor = `${sub.color}40`}>
      <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, cursor: "pointer" }}>
        <div style={{ width: 3, height: 40, borderRadius: 2, background: sub.color, flexShrink: 0 }} />
        <div>
          <p style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 15, margin: "0 0 3px", fontWeight: 600 }}>{sub.label}</p>
          <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{sub.venue} · Starts {sub.startTime}</p>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div onClick={onClick} style={{ textAlign: "right", cursor: "pointer" }}>
          <div style={{ background: `${sub.color}18`, border: `1px solid ${sub.color}40`, borderRadius: 20, padding: "3px 12px", marginBottom: 4 }}>
            <span style={{ color: sub.color, fontSize: 11, fontFamily: "Georgia", letterSpacing: 1 }}>{sub.startTime}</span>
          </div>
          <p style={{ color: "#6b7280", fontSize: 11, fontFamily: "Georgia", margin: 0 }}>{(sub.items || []).length} items</p>
        </div>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${sub.label}" and all its timeline items? This cannot be undone.`)) onDelete(sub.id) }}
            style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 7, color: "#ef4444", fontSize: 13, padding: "6px 10px", cursor: "pointer", flexShrink: 0 }}>
            🗑
          </button>
        )}
      </div>
    </div>
  )
}

// ── RECONCILIATION BANNER ─────────────────────────────────────
// Shows ONE aggregated banner per item (bug fix: was one per delay record)
function ReconciliationBanner({ itemId, delayLogs, currentVendor, onApprove, onDecline }) {
  if (!isCoord(currentVendor)) return null // vendors never see this

  const itemLogs = delayLogs[String(itemId)] || []
  const pendingLogs = itemLogs.filter(d => d.reconciliation_status === "pending")
  if (pendingLogs.length === 0) return null

  // Aggregate: sum estimated, use latest actual_mins (they all resolve to same item)
  const totalEstimated = pendingLogs.reduce((sum, d) => sum + (d.delay_mins || 0), 0)
  const actualMins = pendingLogs[0]?.actual_mins || 0
  const diff = actualMins - totalEstimated
  if (Math.abs(diff) < 2) return null // no meaningful delta

  const isOver = diff > 0
  const color = isOver ? "#f87171" : "#34d399"
  const label = isOver
    ? `Ran ${diff}min over estimate — shift timeline?`
    : `Finished ${Math.abs(diff)}min under estimate — recover time?`
  const canApprove = isLead(currentVendor)

  return (
    <div style={{ background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 8, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <p style={{ color, fontSize: 11, fontFamily: "Georgia", fontWeight: 700, margin: "0 0 2px" }}>
            {isOver ? "⚠" : "✅"} {label}
          </p>
          <p style={{ color: "#94a3b8", fontSize: 10, fontFamily: "Georgia", margin: 0 }}>
            Estimated {totalEstimated}min · Actual {actualMins}min · Logged by {pendingLogs.map(d => d.vendor_name).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
          </p>
        </div>
        {canApprove ? (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => pendingLogs.forEach(d => onApprove(d))}
              style={{ background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 5, color, fontSize: 10, fontFamily: "Georgia", padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
              Approve
            </button>
            <button onClick={() => pendingLogs.forEach(d => onDecline(d))}
              style={{ background: "transparent", border: "1px solid #e5e7eb", borderRadius: 5, color: "#4b5563", fontSize: 10, fontFamily: "Georgia", padding: "4px 10px", cursor: "pointer" }}>
              Decline
            </button>
          </div>
        ) : (
          <span style={{ color: "#94a3b8", fontSize: 10, fontFamily: "Georgia", flexShrink: 0, whiteSpace: "nowrap" }}>
            Pending Lead approval
          </span>
        )}
      </div>
    </div>
  )
}

// ── DELAY LOG ─────────────────────────────────────────────────
function DelayLog({ itemId, delayLogs, currentVendor }) {
  const logs = delayLogs[String(itemId)] || []
  if (logs.length === 0) return null
  const canSeeDetails = isCoord(currentVendor)
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid #1e2d40", paddingTop: 8 }}>
      <p style={{ color: "#6b7280", fontSize: 10, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 6px" }}>DELAY LOG</p>
      {logs.map((d, i) => {
        const statusColor = d.reconciliation_status === "approved" ? "#34d399"
          : d.reconciliation_status === "declined" ? "#475569"
          : d.reconciliation_status === "pending" ? "#fbbf24"
          : "#475569"
        return (
          <div key={i} style={{ marginBottom: 6, padding: "6px 8px", background: "#f1f0ed", borderRadius: 6, borderLeft: `2px solid ${statusColor}` }}>
            {canSeeDetails ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#f87171", fontSize: 11, fontFamily: "Georgia", fontWeight: 700 }}>+{d.delay_mins}min</span>
                  <span style={{ color: "#9ca3af", fontSize: 10, fontFamily: "Georgia" }}>{fmtTimestamp(d.submitted_at)}</span>
                </div>
                <p style={{ color: "#4b5563", fontSize: 11, fontFamily: "Georgia", margin: "2px 0 0" }}>
                  {d.reason} — <span style={{ color: "#60a5fa" }}>{d.vendor_name}</span>
                </p>
                {d.completed_at && (
                  <p style={{ color: "#6b7280", fontSize: 10, fontFamily: "Georgia", margin: "2px 0 0" }}>
                    Completed {fmtTimestamp(d.completed_at)} · Actual: {d.actual_mins}min{" "}
                    <span style={{ color: statusColor }}>({d.reconciliation_status})</span>
                  </p>
                )}
              </>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#f87171", fontSize: 11, fontFamily: "Georgia" }}>
                  +{d.delay_mins}min delay — {d.vendor_name}
                </span>
                <span style={{ color: "#9ca3af", fontSize: 10, fontFamily: "Georgia" }}>{fmtTimestamp(d.submitted_at)}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── IMPORT RUN-OF-SHOW MODAL ──────────────────────────────────
// TODO: Wire to Claude API via Supabase Edge Function for real document parsing.
// The Edge Function should:
//   1. Accept base64 PDF or raw text
//   2. Call claude-sonnet-4-20250514 with a structured extraction prompt
//   3. Return JSON matching the sub_events schema below
//   4. Replace the hardcoded return below with: const res = await fetch("/functions/v1/parse-run-of-show", ...)
//
// Current stub: full real parsed data from Deborah & Nifemi wedding document v2 (May 15, 2026)
function parseRunOfShow(fileText) {
  const ts = () => Date.now() + Math.floor(Math.random() * 1000000)
  const item = (time, endTime, label, involved, notes) => ({
    id: ts(), time, endTime, startTime: time, adjustedStart: time, adjustedEnd: endTime,
    label, involved, notes, itemStatus: "upcoming", delayMins: 0
  })
  return {
    sub_events: [

      // ── PRE-WEDDING ──────────────────────────────────────────
      {
        id: ts(), label: "Wed May 13 — Rehearsal", venue: "Isaac Generation Church",
        startTime: "6:40 PM", color: "#a78bfa",
        items: [
          item("6:40 PM","7:00 PM","Kanah Team Arrival & Debrief",["coordinator"],"Precious, Mofe, Hephzibah"),
          item("7:00 PM","7:15 PM","Arrival & Welcome",["coordinator","dj"],"Couple, officiant, immediate family, DJ"),
          item("7:15 PM","7:45 PM","Ceremony Walkthrough — Round 1",["coordinator","dj"],"Practice processional order (parents in pairs, couple). Walk through timing and pacing with music. Practice placement at altar."),
          item("7:45 PM","8:15 PM","Ceremony Walkthrough — Round 2",["coordinator","dj"],"Full run-through: entrance, readings, vows, exchange of rings, recessional. Officiant gives reminders on cues. Coordinator notes timing adjustments."),
          item("8:15 PM","8:25 PM","Final Run — Round 3 (Optional)",["coordinator"],"Quick full start-to-finish to ensure everyone is confident."),
          item("8:25 PM","8:35 PM","Reception Entrance Rehearsal",["coordinator"],"Couple and bridal party"),
          item("8:35 PM","9:00 PM","Wrap Up & Wedding Day Expectations",["coordinator"],"Coordinators answer questions. Confirm arrival times. Wedding day roles & responsibilities. Dismissal to rehearsal dinner."),
        ]
      },
      {
        id: ts(), label: "Thu May 14 — Early Setup", venue: "Trinity Event Center",
        startTime: "12:00 PM", color: "#f472b6",
        items: [
          item("12:00 PM","8:00 PM","Trad/Reception Decor Setup",["decor"],"Nikki Events. Full venue dress for both traditional and reception spaces."),
        ]
      },

      // ── WEDDING DAY — PARALLEL TRACKS ───────────────────────
      {
        id: ts(), label: "Fri — Getting Ready", venue: "Westin Memorial Hotel",
        startTime: "5:00 AM", color: "#f87171",
        items: [
          item("5:00 AM","7:00 AM","Bride — Makeup Chair",[],"Bride, Ashley (Moka Beauty)"),
          item("5:40 AM","6:00 AM","Gele Artist Arrival",[],"Gele artist arrives"),
          item("6:00 AM","7:10 AM","Bridesmaids Arrive & Gele — Rolling",[],"8 bridesmaids. Arrive already made up. Elizabeth, Esther, Emmanuella (hotel). Tunmise, Precious, Eniola, Kanyin, Angie (commute). Stagger based on gele team count."),
          item("6:00 AM","7:00 AM","Groom & Groomsmen Get Dressed",[],"Separate suite. 7+ groomsmen."),
          item("6:50 AM","7:00 AM","Bridal Designer Arrival",[],"Aunty Tolu — help Deborah get in her dress"),
          item("6:50 AM","7:00 AM","Videographer Arrives",["videography"],"Mitch — getting-ready B-roll"),
          item("7:00 AM","7:20 AM","Photographer Arrives — Detail Shots",["photography"],"Eli Capture — dress, rings, shoes, bouquet, flat lay"),
          item("7:00 AM","7:20 AM","Bride's Gele & Gets Dressed",["photography","videography"],"Bride & MOH. Photographer & videographer capture moment."),
          item("7:00 AM","7:20 AM","Groom Dressed & Ready",["photography","videography"],"Groom portraits + groomsmen group shot (trad attire)"),
          item("7:20 AM","8:10 AM","Bridesmaids Group Shot & Portraits — Trad",["photography","videography"],"Hotel indoor or outdoor area"),
          item("8:15 AM","8:30 AM","Full Bridal Party Departs for Trinity",["coordinator","photography","videography"],"Confirm transport plan. Mitch leaves at 8:00 AM to set up for trad."),
          // Post-traditional wedding
          item("11:20 AM","11:30 AM","Lunch Delivery & Setup",["catering"],"Post-traditional wedding rest period"),
          item("11:30 AM","11:40 AM","Couple Arrives at Hotel — HMUA Retouch",["photography"],"Bride, Groom, HMUA. Quick touch-up before portraits."),
          item("11:30 AM","11:40 AM","Rest — Bride & Groom Change to Robes",[],"Bride & Bridesmaids"),
          item("11:40 AM","12:30 PM","Videographer Arrival + Makeup Refresh",["videography"],"Mitch — drone shots and getting ready photos. Bridesmaids self touch-up."),
          item("12:00 PM","12:30 PM","Hair Stylist Arrival",[],"Busi Styles"),
          item("12:30 PM","1:30 PM","Bride's Hair",[],"Busi Styles"),
          item("12:30 PM","1:30 PM","Groom & Groomsmen Change to Church Attire",["videography"],"Mitch, bestman, groom. Groom putting on the suit shots."),
          item("1:20 PM","1:40 PM","Bridesmaids Robe Photos",["photography"],"Bride to join no later than 1:30 PM"),
          item("1:40 PM","2:00 PM","Bride Puts On Her Dress",["photography","videography"],""),
          item("1:00 PM","2:05 PM","Photographer Arrives",["photography"],"CJ - Eli Capture"),
          item("2:05 PM","2:35 PM","First Look & Portraits",["photography","videography"],"Prioritize couple portraits. Grab one or two with bridal party if time."),
          item("2:35 PM","2:45 PM","Head to Church — NO LATER THAN 2:35",["coordinator"],"RCCG Isaac Generation Assembly, Sugar Branch Drive, Houston TX"),
        ]
      },
      {
        id: ts(), label: "Fri — Vendor Setup", venue: "Trinity Event Center",
        startTime: "7:00 AM", color: "#2dd4bf",
        items: [
          item("7:00 AM","7:30 AM","Venue Access / Early Entry",["venue"],"Trinity Venue Team. Confirm earliest access time with venue."),
          item("7:30 AM","8:00 AM","Coordinators Arrive",["coordinator"],"Kanah Events Co."),
          item("7:30 AM","8:30 AM","Trad Decor Setup — Partitioned Half",["decor"],"Nikky Events. Fully dressed by 8:30 AM."),
          item("7:30 AM","8:30 AM","Reception Decor Setup — Other Half",["decor"],"Nikky Events. Work simultaneously; do not disturb trad side."),
          item("11:00 AM","5:00 PM","Trad Breakdown & Reception Setup Completion",["decor","staffing"],"Nikky Events. Critical turnaround — all hands on deck. Must be guest-ready before cocktail hour at 5:00 PM."),
          item("12:00 PM","1:00 PM","Live Band Setup & Sound Check",["livemusic"],"Harmonics. Coordinate stage layout with DJ."),
          item("1:40 PM","2:00 PM","Precious & Mofe Head to Church",["coordinator"],"Hephzibah remains at Trinity to coordinate setup."),
          item("3:00 PM","4:00 PM","Small Chops Vendor — Onsite Cooking",["catering"],""),
          item("3:00 PM","4:00 PM","Honeywell Catering Setup",["catering"],""),
          item("3:00 PM","4:00 PM","Fruit Display Setup",["catering"],""),
          item("5:00 PM","5:30 PM","Event Staff Arrival — Round 1",["staffing"],"8 servers. Trays up service + mocktails."),
          item("5:30 PM","6:00 PM","MC Arrival",["mc"],"Joseph Babalola"),
          item("7:00 PM","7:30 PM","Event Staff Arrival — Round 2",["staffing"],"7 servers"),
        ]
      },
      {
        id: ts(), label: "Fri — Captured Moments", venue: "Multiple Locations",
        startTime: "6:50 AM", color: "#60a5fa",
        items: [
          item("6:50 AM","7:00 AM","Videographer Arrives — Hotel",["videography"],"Mitch — getting-ready B-roll"),
          item("7:00 AM","7:20 AM","Photographer Arrives — Detail Shots",["photography"],"CJ / Eli Capture — dress, rings, shoes, bouquet, flat lay"),
          item("7:05 AM","7:20 AM","Groomsmen Portraits",["photography","videography"],"Bridesmaids, CJ - Eli Capture, Mitch"),
          item("7:20 AM","8:10 AM","Bridesmaids Group Shot & Portraits — Trad",["photography","videography"],"Hotel indoor or outdoor area"),
          item("8:10 AM","8:30 AM","Trad Decor Detail Shots",["photography"],"Favour (TBD). Before guests arrive."),
          item("9:00 AM","11:00 AM","Key Trad Moments Coverage",["photography"],"Eli Capture's Associate. Confirm key-moments list with Alaga in advance. Family portraits during trad to save time."),
          item("11:00 AM","2:00 PM","Coverage Break",["photography","videography"],"Eli Capture's Team + Mitch"),
          item("11:40 AM","12:00 PM","Videographer Arrival — Westin",["videography"],"Mitch — drone shots and getting ready photos"),
          item("1:00 PM","2:05 PM","Photographer Arrival — Westin",["photography"],"CJ / Eli Capture"),
          item("2:05 PM","2:35 PM","First Look & Portraits",["photography","videography"],"Prioritize couple portraits; grab one or two with BP if time"),
          item("2:20 PM","2:35 PM","Videographer Departs to Church",["videography"],"Mitch heads to church to set up sound and cameras"),
          item("3:00 PM","5:00 PM","Church Ceremony Coverage",["photography","videography"],"Eli Capture, Mitch"),
          item("5:00 PM","5:30 PM","Immediate Family Formals — Church",["photography","coordinator"],"Pre-list groupings. MC/coordinator calls groups. Refer to Shot List for Names."),
          item("5:30 PM","5:40 PM","Extended Family & After Ceremony Formals",["photography","videography"],"2-3 min per grouping max. Refer to Shot List for Names."),
          item("5:40 PM","6:20 PM","Reception Detail Shots & Bridal Party Session",["photography","videography"],"All, Eli Capture, Mitch. Refer to Shot List for Names."),
          item("10:00 PM","10:00 PM","Photography Coverage Ends",["photography"],"Eli Captures"),
          item("12:00 AM","12:00 AM","Videography End Time",["videography"],""),
        ]
      },

      // ── EVENT FLOW ───────────────────────────────────────────
      {
        id: ts(), label: "Traditional Wedding", venue: "Trinity Event Center",
        startTime: "8:30 AM", color: "#fbbf24",
        items: [
          item("8:30 AM","8:55 AM","Guest Arrival & Seating",["coordinator"],"Coordinators to facilitate seating of guests"),
          item("8:55 AM","9:00 AM","Doors Close",["coordinator"],""),
          item("9:00 AM","9:15 AM","Family Entrance & Introductions",["coordinator","liveband","mc"],"Groom's Family: Korin Iyin - EmmaOMG. Bride's Family: Mercy Chinwo. Proposal letter reading (Esther)."),
          item("9:15 AM","10:35 AM","Traditional Ceremony",["coordinator","liveband","photography","videography"],"Groom's entrance (Music mix provided). Idobale. Bride's entrance (Music mix provided). Veiling of the bride. Wearing of the cap. Eru Iyawo."),
          item("10:35 AM","11:00 AM","Introduction of the New Couple",["coordinator","mc","photography"],"Couple request for igbe iyawo. Capture pictures with families."),
          item("11:00 AM","11:15 AM","Prompt Dismissal",["coordinator","mc"],""),
        ]
      },
      {
        id: ts(), label: "Church Ceremony", venue: "Isaac Generation — RCCG",
        startTime: "2:30 PM", color: "#818cf8",
        items: [
          item("2:30 PM","2:45 PM","Guest Arrival & Seating",["coordinator"],"Ushers to facilitate seating of guests"),
          item("2:45 PM","2:50 PM","Guests Seated",["coordinator"],"Alagas, Bride's Family"),
          item("2:50 PM","3:00 PM","Closed Doors",["coordinator"],""),
          item("3:00 PM","3:05 PM","Opening Prayer",["coordinator"],"Open for day-of assignment"),
          item("3:05 PM","3:15 PM","Praise & Worship",["livemusic"],"Choir"),
          item("3:15 PM","3:22 PM","Processional Hymn",["livemusic"],"Choir. Congregation remains standing."),
          item("3:22 PM","3:28 PM","Entrance of the Bridal Party",["coordinator","dj","photography","videography"],"Groom Song: You (Without You) - Savy Henry (on loop until BP entrance complete). Pairs: Elizabeth & Oluwaferanmi, Emmanuella & Emmanuel, Esther & Opeyemi, Eniola & Samuel, Tunmise & Olumide, Precious & Kojo, Angie & IK, Kanyin & Emmanuel & Victor. Flowergirls (4), Little Bride & Ring Bearer."),
          item("3:28 PM","3:29 PM","ALL RISE",["coordinator"],""),
          item("3:29 PM","3:34 PM","Bride's Entrance",["coordinator","photography","videography"],"Bride & Pastor Babalola. Song: Perfectly Perfect - Savy Henry"),
          item("3:35 PM","3:55 PM","Joining & Blessing of the Couple",["coordinator"],"Pastor Awobajo officiates"),
          item("3:55 PM","4:00 PM","Special Ministration",["livemusic"],"Min. Ebenezer — 4 songs"),
          item("4:00 PM","4:15 PM","Short Exhortation",["coordinator"],"Rev. John"),
          item("4:25 PM","4:40 PM","Signing of the Marriage Register",["coordinator","photography","videography"],"Pastor Awobajo, Bride & Groom, Parents, MOH & BM. Ebuka leads praise. Signing is outside the sanctuary in the conference room — ensure all is in place."),
          item("4:45 PM","4:55 PM","Thanksgiving Praise",["livemusic","coordinator"],"Ebuka; Pastor Ayeni"),
          item("4:55 PM","5:05 PM","Prayer for the Couple",["coordinator"],"Pst. & Pst Mrs. Ojo (Summons Ministers)"),
          item("5:05 PM","5:15 PM","Recessional Hymn",["coordinator"],"Couple exits; bridal party follows"),
          item("5:30 PM","5:45 PM","Depart to Trinity — Dismissal of All Guests",["coordinator","mc"],"Deborah & Nifemi & BP. ~20 min drive; cocktail hour in progress."),
        ]
      },
      {
        id: ts(), label: "Cocktail Hour & Reception", venue: "Trinity Event Center",
        startTime: "5:00 PM", color: "#34d399",
        items: [
          item("5:00 PM","5:30 PM","Guest Arrival — Cocktail Hour",["coordinator","catering","staffing"],"Trays up: appetizers, small chops, fruit. Bar open."),
          item("5:30 PM","6:30 PM","Cocktail Hour",["coordinator","catering","staffing","photography","videography"],"Bridal party photos in banquet (contingent on ceremony end time). Nikky Events Staff, bar open."),
          item("6:20 PM","6:30 PM","Guest Transition to Hall",["coordinator","mc","dj"],"MC invites guests in. Coordinators facilitate seating."),
          item("6:30 PM","6:35 PM","MC Opening Remarks",["mc"],"House-keeping: No direct spraying of money (basket provided). Money changing table."),
          item("6:35 PM","6:45 PM","Bride's Family Intro & Entrance",["mc","livemusic"],"Parents of the Bride: Pastor & Mrs Jide Babalola"),
          item("6:45 PM","6:55 PM","Groom's Family Intro & Entrance",["mc","livemusic"],"Pastor Oluwasegun Ogunmodede Joseph & Pastor Omotayo Ogunmodede Joseph"),
          item("6:55 PM","7:00 PM","Bridal Party Entrance",["mc","dj","photography","videography"],"Soul train on the floor. Mix will be provided. Shoutouts: Elizabeth & Oluwaferanmi, Emmanuella & Emmanuel, Esther & Opeyemi, Eniola & Samuel, Tunmise & Olumide, Precious & Kojo, Angie & IK, Kanyin & Emmanuel & Victor."),
          item("7:00 PM","7:15 PM","Couple Grand Entrance — ALL RISE",["mc","dj","photography","videography"],"Song TBD."),
          item("7:15 PM","7:20 PM","Opening Prayer",["coordinator"],"Pastor Akintunde"),
          item("7:20 PM","7:20 PM","Dinner Service Begins",["catering","staffing","coordinator"],"Table dismissal by Kanah coordinators. Staff assigned to estate table to take orders. Team Kanah to confirm Couple's Dinner is served."),
          item("7:20 PM","7:50 PM","Photo Tour",["photography","videography","livemusic"],"Bride and Groom & CJ & Mitch. Live band plays. Couple greets each table (not estate table) and takes photos — 25 mins. Remain seated until couple arrives."),
          item("7:55 PM","8:00 PM","Mother-Son Dance",["dj","photography","videography"],"Song: Mama - Adekunle Gold"),
          item("8:00 PM","8:05 PM","Mother-Daughter Dance",["dj","photography","videography"],"Song: Iya mi (Sweet Mama)"),
          item("8:05 PM","8:10 PM","Father-Daughter Dance",["dj","photography","videography"],"Song: Daddy - Segun Johnson"),
          item("8:10 PM","8:17 PM","First Dance",["dj","photography","videography"],"No spraying. Songs: Second to None & LOML - Savy Henry"),
          item("8:10 PM","8:17 PM","Wine Service",["staffing"],"Fill guests glasses ahead of toast"),
          item("8:17 PM","8:27 PM","Cake Cutting",["mc","dj","photography","videography","catering"],"Song: Now and Always - Savy Henry. Suggests: Spell Jesus."),
          item("8:27 PM","8:37 PM","Toast",["mc","photography","videography"],"Bestman: Oluwaferanmi Joseph. MOH: Elizabeth Babalola. 5 mins each. Couple exits to changing room by 8:37 PM (out by 8:45 PM)."),
          item("8:40 PM","9:20 PM","Parents on the Dancefloor",["livemusic","coordinator"],"Harmonix. Bride's parents 20 mins, Groom's parents 20 mins."),
          item("9:05 PM","9:20 PM","Quick Portraits — Second Look",["photography","videography"],"CJ, Mitch & Deborah & Nifemi"),
          item("9:20 PM","9:35 PM","Bride & Groom 2nd Entrance",["mc","livemusic","photography","videography"],"Allow spraying on dancefloor. Live Band plays."),
          item("9:40 PM","9:45 PM","Vote of Thanks",["mc"],"5 mins each — 4 speakers (including couple). Staff serve peppersoup."),
          item("9:40 PM","9:50 PM","Serve Dessert & Souvenirs",["catering","staffing","coordinator"],"Sheet cake plated. Start on opposing side from photo tour. Bottle raffle & gift bags distributed."),
          item("9:50 PM","11:30 PM","Transition to After Party",["mc","dj"],"MC & DJ Praise. Late night snack at 10:20 PM: Yam & Plantain (Nikky Staff)."),
          item("11:00 PM","11:30 PM","Cleanup & Breakdown Begins",["decor","staffing"],"Nikky Events"),
          item("11:30 PM","12:00 AM","The Josephs Send-Off",["coordinator","mc"],"MC announces movement to pavilion outside. Bride & Groom send-off at 11:40 PM. Ride waiting outside. Coordinators distribute sparklers to guests."),
          item("12:00 AM","12:00 AM","Videography End Time",["videography"],""),
        ]
      }
    ]
  }
}
function ImportModal({ onClose, onImport }) {
  const [stage, setStage] = useState("upload") // upload | parsing | preview
  const [parsed, setParsed] = useState(null)
  const fileRef = useRef(null)

  const handleFile = (file) => {
    if (!file) return
    setStage("parsing")
    // TODO: Replace with Claude API Edge Function call for real AI parsing.
    // PDFs cannot be read as plain text in the browser — the Edge Function
    // should accept a base64-encoded file and return structured JSON.
    // For now: simulate parsing delay then return real pre-parsed Deborah & Nifemi data.
    setTimeout(() => {
      const result = parseRunOfShow("")
      setParsed(result)
      setStage("preview")
    }, 1400)
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 28, width: "100%", maxWidth: 560, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 20, margin: 0 }}>📄 Import Run-of-Show</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>

        {stage === "upload" && (
          <div>
            <p style={{ color: "#4b5563", fontFamily: "Georgia", fontSize: 13, margin: "0 0 16px" }}>
              Upload your run-of-show document to auto-create sub-events and timeline items.
            </p>
            <div style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
              <p style={{ color: "#60a5fa", fontFamily: "Georgia", fontSize: 11, margin: 0 }}>
                📋 For Deborah & Nifemi: the document is pre-loaded — just upload any file to preview and import the full timeline.
              </p>
            </div>
            <div onClick={() => fileRef.current?.click()}
              style={{ border: "2px dashed #1e2d40", borderRadius: 12, padding: "40px 20px", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#c084fc40"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#e5e7eb"}>
              <p style={{ color: "#4b5563", fontFamily: "Georgia", fontSize: 14, margin: "0 0 8px" }}>Click to upload</p>
              <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>.txt or .pdf accepted</p>
            </div>
            <input ref={fileRef} type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            <p style={{ color: "#6b7280", fontSize: 10, fontFamily: "Georgia", margin: "12px 0 0", textAlign: "center" }}>
              // TODO: Wire to Claude API via Supabase Edge Function
            </p>
          </div>
        )}

        {stage === "parsing" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ width: 32, height: 32, border: "3px solid #c084fc", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <p style={{ color: "#7c3aed", fontFamily: "Georgia", fontSize: 14 }}>Parsing document...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {stage === "preview" && parsed && (
          <div>
            <p style={{ color: "#34d399", fontFamily: "Georgia", fontSize: 13, margin: "0 0 16px" }}>
              ✅ Found {parsed.sub_events.length} sub-event{parsed.sub_events.length !== 1 ? "s" : ""} — review before importing
            </p>
            {parsed.sub_events.map((sub, si) => (
              <div key={si} style={{ background: "#f1f0ed", border: `1.5px solid ${sub.color}40`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 3, height: 24, borderRadius: 2, background: sub.color }} />
                  <div>
                    <p style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 14, margin: 0, fontWeight: 600 }}>{sub.label}</p>
                    <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 11, margin: 0 }}>{sub.venue} · {sub.startTime}</p>
                  </div>
                </div>
                {(sub.items || []).map((item, ii) => (
                  <div key={ii} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #1e2d40" }}>
                    <span style={{ color: "#4b5563", fontFamily: "Georgia", fontSize: 11, width: 80, flexShrink: 0 }}>{item.time}</span>
                    <span style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 12 }}>{item.label}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => onImport(parsed)}
                style={{ flex: 2, padding: "11px", background: "#7c3aed", border: "none", borderRadius: 8, color: "#ffffff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia" }}>
                Import All →
              </button>
              <button onClick={onClose}
                style={{ flex: 1, padding: "11px", background: "transparent", border: "1px solid #e5e7eb", borderRadius: 8, color: "#4b5563", fontSize: 13, cursor: "pointer", fontFamily: "Georgia" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── VENDOR ITEM CARD ──────────────────────────────────────────
function VendorItemCard({ item, currentVendor, onLogDelay, onStatusChange, onEditItem, onDeleteItem, onApproveReconciliation, onDeclineReconciliation, delayLogs, isNow, itemRef, isBackend }) {
  const [showDelayForm, setShowDelayForm] = useState(false)
  const [delayMins, setDelayMins] = useState(10)
  const [delayReason, setDelayReason] = useState("")
  const [delayReasonError, setDelayReasonError] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [showDelayLog, setShowDelayLog] = useState(false)
  const [editLabel, setEditLabel] = useState(item.label)
  const [editTime, setEditTime] = useState(item.time || item.startTime || "")
  const [editEndTime, setEditEndTime] = useState(item.endTime || "")
  const [editInvolved, setEditInvolved] = useState((item.involved || []).join(", "))
  const [editNotes, setEditNotes] = useState(item.notes || "")
  const statusMenuRef = useRef(null)

  // isBackend=true means we're on the coordinator's backend dashboard — always grant full access
  const coordinator = isBackend || isCoord(currentVendor)
  const lead = isBackend || isLead(currentVendor)
  const assistant = !isBackend && isAssistant(currentVendor)
  const currentStatus = ITEM_STATUSES.find(s => s.key === (item.itemStatus || "upcoming"))
  const hasDelay = item.adjustedStart && item.startTime && item.adjustedStart !== item.startTime
  const itemDelayLogs = delayLogs[String(item.id)] || []
  const hasPendingReconciliation = coordinator && itemDelayLogs.some(d => d.reconciliation_status === "pending")

  const availableStatuses = (lead || assistant) ? ITEM_STATUSES : ITEM_STATUSES.filter(s => s.key !== "skipped")

  useEffect(() => {
    if (!showStatusMenu) return
    const h = (e) => { if (statusMenuRef.current && !statusMenuRef.current.contains(e.target)) setShowStatusMenu(false) }
    const timer = setTimeout(() => document.addEventListener("mousedown", h), 0)
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", h) }
  }, [showStatusMenu])

  const handleStatusSelect = (key) => {
    if (key === "delayed") { setShowDelayForm(true); setShowStatusMenu(false); return }
    setShowDelayForm(false); setDelayReason(""); setDelayReasonError(false)
    onStatusChange(item, key)
    setShowStatusMenu(false)
  }

  const handleSaveEdit = async () => {
    await onEditItem(item, {
      time: editTime, endTime: editEndTime, label: editLabel,
      involved: editInvolved.split(",").map(s => s.trim()).filter(Boolean), notes: editNotes
    })
    setIsEditing(false)
  }

  const handleSubmitDelay = async () => {
    if (!delayReason.trim()) { setDelayReasonError(true); return }
    setDelayReasonError(false)
    await onLogDelay(item, delayMins, delayReason)
    setShowDelayForm(false); setDelayReason("")
  }

  // Pulsing border style for current activity
  const borderColor = isNow ? "#c084fc"
    : hasPendingReconciliation ? "#fbbf24"
    : item.itemStatus === "delayed" ? "rgba(248,113,113,0.3)"
    : item.itemStatus === "completed" || item.itemStatus === "early" ? "rgba(52,211,153,0.3)"
    : "#e5e7eb"
  const boxShadow = isNow ? "0 0 0 2px #c084fc40, 0 0 16px #c084fc20" : "none"

  return (
    <div ref={itemRef} style={{ display: "flex", alignItems: "flex-start", marginBottom: 16 }}>
      {/* Time column */}
      <div style={{ width: 90, flexShrink: 0, paddingTop: 4, textAlign: "right" }}>
        <div style={{ color: hasDelay ? "#f87171" : "#475569", fontFamily: "Georgia", fontSize: 12 }}>
          {item.adjustedStart || item.startTime || item.time}
        </div>
        {item.adjustedEnd && <div style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 10 }}>→ {item.adjustedEnd}</div>}
        {hasDelay && <div style={{ color: "#f87171", fontSize: 9, fontFamily: "Georgia" }}>+{item.delayMins}min</div>}
      </div>

      {/* Dot */}
      <div style={{ width: 16, margin: "0 10px", display: "flex", justifyContent: "center", paddingTop: 8, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: isNow ? "#c084fc" : item.subColor, border: `2px solid ${isNow ? "#c084fc" : item.subColor}`, position: "relative", zIndex: 2 }} />
      </div>

      {/* Card */}
      <div style={{ flex: 1, background: "#ffffff", border: `1px solid ${borderColor}`, borderRadius: 8, overflow: "visible", boxShadow, transition: "box-shadow 0.3s, border-color 0.3s" }}>
        {isNow && (
          <div style={{ background: "rgba(124,58,237,0.06)", borderBottom: "1px solid rgba(124,58,237,0.15)", padding: "3px 12px" }}>
            <span style={{ color: "#7c3aed", fontSize: 9, fontFamily: "Georgia", letterSpacing: 2 }}>📍 HAPPENING NOW</span>
          </div>
        )}
        <div style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: item.itemStatus === "skipped" ? "#9ca3af" : "#111827", fontFamily: "Georgia", fontSize: 14, margin: "0 0 2px", fontWeight: 600, textDecoration: item.itemStatus === "skipped" ? "line-through" : "none" }}>
                {currentStatus?.emoji} {item.label}
              </p>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ background: `${item.subColor}15`, border: `1px solid ${item.subColor}30`, borderRadius: 4, padding: "1px 7px", color: item.subColor, fontSize: 9, fontFamily: "Georgia", letterSpacing: 1 }}>{item.subLabel}</span>
                {item.endTime && <span style={{ color: "#6b7280", fontSize: 10, fontFamily: "Georgia" }}>{item.time} – {item.endTime}</span>}
              </div>
            </div>

            {/* Status dropdown */}
            <div ref={statusMenuRef} style={{ position: "relative" }}>
              <button onClick={() => setShowStatusMenu(o => !o)} style={{
                background: `${currentStatus?.color}12`, border: `1.5px solid ${currentStatus?.color}50`,
                borderRadius: 6, color: currentStatus?.color, fontSize: 10,
                fontFamily: "Georgia", padding: "3px 8px", cursor: "pointer", letterSpacing: 1
              }}>{currentStatus?.label} ▼</button>
              {showStatusMenu && (
                <div style={{ position: "absolute", right: 0, top: 28, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 6, zIndex: 100, minWidth: 130, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                  {availableStatuses.map(s => (
                    <div key={s.key} onClick={() => handleStatusSelect(s.key)}
                      style={{ padding: "6px 8px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                      onMouseEnter={e => e.currentTarget.style.background = `${s.color}12`}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span style={{ fontSize: 12 }}>{s.emoji}</span>
                      <span style={{ color: s.color, fontSize: 11, fontFamily: "Georgia" }}>{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {item.notes && !isEditing && (
            <p style={{ color: "#374151", fontFamily: "Georgia", fontSize: 13, margin: "4px 0 8px", lineHeight: 1.7 }}>{item.notes}</p>
          )}

          {isEditing && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, display: "block", marginBottom: 4, fontFamily: "Georgia" }}>START TIME</label>
                  <input value={editTime} onChange={e => setEditTime(e.target.value)}
                    style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 6, color: "#1a1a2e", fontSize: 13, padding: "7px 10px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, display: "block", marginBottom: 4, fontFamily: "Georgia" }}>END TIME</label>
                  <input value={editEndTime} onChange={e => setEditEndTime(e.target.value)}
                    style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 6, color: "#1a1a2e", fontSize: 13, padding: "7px 10px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                </div>
              </div>
              <div>
                <label style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, display: "block", marginBottom: 4, fontFamily: "Georgia" }}>ACTIVITY</label>
                <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                  style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 6, color: "#1a1a2e", fontSize: 13, padding: "7px 10px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>PARTIES INVOLVED</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                  {VENDOR_ROLES.map(role => {
                    const currentList = editInvolved.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
                    const selected = currentList.includes(role.label.toLowerCase())
                    return (
                      <button key={role.key} type="button" onClick={() => {
                        const current = editInvolved.split(",").map(s => s.trim()).filter(Boolean)
                        const idx = current.findIndex(c => c.toLowerCase() === role.label.toLowerCase())
                        if (idx >= 0) { current.splice(idx, 1) } else { current.push(role.label) }
                        setEditInvolved(current.join(", "))
                      }} style={{
                        padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontFamily: "Georgia", fontSize: 10,
                        background: selected ? role.color : "#ffffff",
                        border: `1.5px solid ${selected ? role.color : "#d1d5db"}`,
                        color: selected ? "#ffffff" : "#374151",
                        fontWeight: selected ? 700 : 400, transition: "all 0.15s"
                      }}>{role.label}</button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, display: "block", marginBottom: 4, fontFamily: "Georgia" }}>NOTES</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3}
                  style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 6, color: "#1a1a2e", fontSize: 13, padding: "7px 10px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box", resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleSaveEdit} style={{ flex: 2, padding: "8px", background: "rgba(192,132,252,0.12)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 6, color: "#7c3aed", fontSize: 12, fontFamily: "Georgia", cursor: "pointer", fontWeight: 700 }}>Save Changes</button>
                <button onClick={() => setIsEditing(false)} style={{ flex: 1, padding: "8px", background: "transparent", border: "1px solid #e5e7eb", borderRadius: 6, color: "#4b5563", fontSize: 12, fontFamily: "Georgia", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            {item.itemStatus !== "skipped" && item.itemStatus !== "completed" && item.itemStatus !== "early" && (
              <button onClick={() => setShowDelayForm(!showDelayForm)} style={{
                background: showDelayForm ? "#f3f4f6" : "rgba(248,113,113,0.06)",
                border: `1px solid ${showDelayForm ? "#d1d5db" : "rgba(248,113,113,0.4)"}`,
                borderRadius: 5, color: showDelayForm ? "#6b7280" : "#ef4444",
                fontSize: 11, fontFamily: "Georgia", padding: "4px 10px", cursor: "pointer"
              }}>{showDelayForm ? "Cancel" : "⏱ Log Delay"}</button>
            )}

            {coordinator && (
              <>
                <button onClick={() => { setIsEditing(!isEditing); setShowDelayForm(false) }}
                  style={{ background: isEditing ? "#f3f4f6" : "rgba(37,99,235,0.06)", border: `1px solid ${isEditing ? "#e5e7eb" : "rgba(37,99,235,0.25)"}`, borderRadius: 5, color: isEditing ? "#6b7280" : "#2563eb", fontSize: 11, fontFamily: "Georgia", padding: "4px 10px", cursor: "pointer" }}>
                  {isEditing ? "Cancel Edit" : "✏ Edit"}
                </button>
                {lead && (
                  <button onClick={() => { if (window.confirm(`Delete "${item.label}"?`)) onDeleteItem(item) }}
                    style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 5, color: "#f87171", fontSize: 11, fontFamily: "Georgia", padding: "4px 10px", cursor: "pointer" }}>
                    🗑 Delete
                  </button>
                )}
              </>
            )}

            {itemDelayLogs.length > 0 && (
              <button onClick={() => setShowDelayLog(!showDelayLog)}
                style={{ background: "transparent", border: "1px solid #e5e7eb", borderRadius: 5, color: "#4b5563", fontSize: 11, fontFamily: "Georgia", padding: "4px 10px", cursor: "pointer", marginLeft: "auto" }}>
                {showDelayLog ? "Hide Log" : `📋 ${itemDelayLogs.length} Delay${itemDelayLogs.length > 1 ? "s" : ""}`}
              </button>
            )}
          </div>

          {/* Reconciliation — coordinators only */}
          <ReconciliationBanner
            itemId={item.id}
            delayLogs={delayLogs}
            currentVendor={currentVendor}
            onApprove={onApproveReconciliation}
            onDecline={onDeclineReconciliation}
          />

          {showDelayLog && <DelayLog itemId={item.id} delayLogs={delayLogs} currentVendor={currentVendor} />}
        </div>

        {showDelayForm && (
          <div style={{ borderTop: "1px solid #e5e7eb", padding: "12px 14px", background: "#fafafa" }}>
            <p style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 10px" }}>LOG A DELAY</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {[5, 10, 15, 20, 30, 45, 60].map(m => (
                <button key={m} onClick={() => setDelayMins(m)} style={{
                  padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontFamily: "Georgia",
                  background: delayMins === m ? "rgba(248,113,113,0.12)" : "#ffffff",
                  border: `1.5px solid ${delayMins === m ? "#f87171" : "#d1d5db"}`,
                  color: delayMins === m ? "#f87171" : "#6b7280", fontSize: 12
                }}>{m}m</button>
              ))}
            </div>
            <input value={delayReason} onChange={e => { setDelayReason(e.target.value); setDelayReasonError(false) }}
              placeholder="Reason required e.g. Family running late..."
              style={{ width: "100%", background: "#f8f7f4", border: `1px solid ${delayReasonError ? "#f87171" : "#e5e7eb"}`, borderRadius: 6, color: "#1a1a2e", fontSize: 12, padding: "8px 10px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box", marginBottom: delayReasonError ? 4 : 8 }} />
            {delayReasonError && <p style={{ color: "#f87171", fontSize: 11, fontFamily: "Georgia", margin: "0 0 8px" }}>A reason is required before submitting.</p>}
            <button onClick={handleSubmitDelay}
              style={{ width: "100%", padding: "8px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 6, color: "#f87171", fontSize: 12, fontFamily: "Georgia", cursor: "pointer", fontWeight: 700 }}>
              Submit +{delayMins}min Delay →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}



// ── MAIN APP ──────────────────────────────────────────────────
export default function App() {
  const [searchParams] = useSearchParams()
  const eventIdFromUrl = searchParams.get("event")

  const [screen, setScreen] = useState("dashboard")
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [selectedSub, setSelectedSub] = useState(null)
  const [showSubEventForm, setShowSubEventForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [showVendorManager, setShowVendorManager] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const [delayLogs, setDelayLogs] = useState({})

  // Vendor state
  const [currentVendor, setCurrentVendor] = useState(null)
  const [vendorEvent, setVendorEvent] = useState(null)
  const [eventVendors, setEventVendors] = useState([])
  const [pinInput, setPinInput] = useState("")
  const [selectedVendorForPin, setSelectedVendorForPin] = useState(null)
  const [pinError, setPinError] = useState("")

  // Vendor filter (vendor timeline only)
  const [vendorFilter, setVendorFilter] = useState("All")

  // Vendor editing
  const [editingVendor, setEditingVendor] = useState(null)
  const [editVendorName, setEditVendorName] = useState("")
  const [editVendorRole, setEditVendorRole] = useState("")
  const [editVendorPin, setEditVendorPin] = useState("")
  const [editVendorTier, setEditVendorTier] = useState("")

  // Create event form
  const [eventName, setEventName] = useState("")
  const [clientName, setClientName] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [venue, setVenue] = useState("")
  const [hashtag, setHashtag] = useState("")

  // Sub-event form
  const [subLabel, setSubLabel] = useState("")
  const [subVenue, setSubVenue] = useState("")
  const [subStartTime, setSubStartTime] = useState("")
  const [subColor, setSubColor] = useState("#c084fc")

  // Item form
  const [itemTime, setItemTime] = useState("")
  const [itemEndTime, setItemEndTime] = useState("")
  const [itemLabel, setItemLabel] = useState("")
  const [itemInvolved, setItemInvolved] = useState("")
  const [itemNotes, setItemNotes] = useState("")

  // Add vendor form
  const [newVendorName, setNewVendorName] = useState("")
  const [newVendorRole, setNewVendorRole] = useState("")
  const [newVendorPin, setNewVendorPin] = useState("")
  const [newVendorTier, setNewVendorTier] = useState("")

  // Jump-to-now refs
  const nowItemRef = useRef(null)

  useEffect(() => { loadEvents() }, [])

  useEffect(() => {
    if (eventIdFromUrl && events.length > 0) {
      const found = events.find(e => String(e.id) === String(eventIdFromUrl))
      if (found) {
        setVendorEvent(found)
        loadEventVendors(found.id)
        loadDelayLogs(found.id)
        const savedVendor = localStorage.getItem(`eventflow_vendor_${found.id}`)
        if (savedVendor) {
          const v = JSON.parse(savedVendor)
          setCurrentVendor(v)
          setScreen("vendor-timeline")
        } else {
          setScreen("vendor-join")
        }
      }
    }
  }, [eventIdFromUrl, events])

  // Realtime: vendor-facing
  useEffect(() => {
    if (!vendorEvent) return
    const channel = supabase
      .channel(`event-${vendorEvent.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `id=eq.${vendorEvent.id}` }, (payload) => {
        setVendorEvent(payload.new)
        setEvents(prev => prev.map(e => e.id === payload.new.id ? payload.new : e))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delays', filter: `event_id=eq.${vendorEvent.id}` }, (payload) => {
        const d = payload.new
        if (d.vendor_name !== currentVendor?.name) {
          setNotifications(prev => [{ id: Date.now(), msg: `⚠ ${d.vendor_name} — ${d.item_label} delayed +${d.delay_mins}min`, type: "delay" }, ...prev].slice(0, 5))
        }
        setDelayLogs(prev => ({ ...prev, [d.item_id]: [...(prev[d.item_id] || []), d] }))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'delays', filter: `event_id=eq.${vendorEvent.id}` }, (payload) => {
        const d = payload.new
        setDelayLogs(prev => ({ ...prev, [d.item_id]: (prev[d.item_id] || []).map(x => x.id === d.id ? d : x) }))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'item_activity', filter: `event_id=eq.${vendorEvent.id}` }, (payload) => {
        const a = payload.new
        if (a.action === "early") setNotifications(prev => [{ id: Date.now(), msg: `😊 ${a.vendor_name} — ${a.item_label} completed early!`, type: "early" }, ...prev].slice(0, 5))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [vendorEvent])

  // Realtime: coordinator-facing
  useEffect(() => {
    if (!selectedEvent) return
    const channel = supabase
      .channel(`coord-event-${selectedEvent.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delays', filter: `event_id=eq.${selectedEvent.id}` }, (payload) => {
        const d = payload.new
        setNotifications(prev => [{ id: Date.now(), msg: `⚠ ${d.vendor_name} — "${d.item_label}" +${d.delay_mins}min`, type: "delay" }, ...prev].slice(0, 5))
        setDelayLogs(prev => ({ ...prev, [d.item_id]: [...(prev[d.item_id] || []), d] }))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'delays', filter: `event_id=eq.${selectedEvent.id}` }, (payload) => {
        const d = payload.new
        setDelayLogs(prev => ({ ...prev, [d.item_id]: (prev[d.item_id] || []).map(x => x.id === d.id ? d : x) }))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [selectedEvent])

  const loadEvents = async () => {
    setLoading(true)
    const { data, error } = await supabase.from("events").select("*").order("event_date", { ascending: true })
    if (!error) setEvents(data || [])
    setLoading(false)
  }

  const loadEventVendors = async (eventId) => {
    const { data } = await supabase.from("event_vendors").select("*").eq("event_id", eventId)
    setEventVendors(data || [])
  }

  const loadDelayLogs = async (eventId) => {
    const { data } = await supabase.from("delays").select("*").eq("event_id", eventId).order("submitted_at", { ascending: true })
    if (!data) return
    const grouped = {}
    data.forEach(d => { grouped[d.item_id] = [...(grouped[d.item_id] || []), d] })
    setDelayLogs(grouped)
  }

  const handleCreate = async () => {
    if (!eventName || !clientName || !eventDate) return
    const { data, error } = await supabase.from("events").insert({ event_name: eventName, client_name: clientName, event_date: eventDate, venue, hashtag, status: "Drafting", sub_events: [], running_delay: 0, health_status: "good" }).select()
    if (!error) {
      setEvents(prev => [...prev, data[0]].sort((a, b) => new Date(a.event_date) - new Date(b.event_date)))
      setEventName(""); setClientName(""); setEventDate(""); setVenue(""); setHashtag("")
      setScreen("dashboard")
    }
  }

  const handleStatusChange = async (id, newStatus) => {
    await supabase.from("events").update({ status: newStatus }).eq("id", id)
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e))
  }

  const handleDeleteEvent = async (id) => {
    if (!window.confirm("Delete this event and all its data? This cannot be undone.")) return
    await supabase.from("events").delete().eq("id", id)
    setEvents(prev => prev.filter(e => e.id !== id))
    setSelectedEvent(null)
  }

  const handleAddSubEvent = async () => {
    if (!subLabel || !subStartTime) return
    const newSub = { id: Date.now(), label: subLabel, venue: subVenue, startTime: subStartTime, color: subColor, items: [] }
    const updatedSubEvents = [...(selectedEvent.sub_events || []), newSub]
    const { error } = await supabase.from("events").update({ sub_events: updatedSubEvents }).eq("id", selectedEvent.id)
    if (!error) {
      setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, sub_events: updatedSubEvents } : e))
      setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
    }
    setSubLabel(""); setSubVenue(""); setSubStartTime(""); setSubColor("#c084fc")
    setShowSubEventForm(false)
  }

  const handleDeleteSubEvent = async (subId) => {
    if (!selectedEvent) return
    const updatedSubEvents = (selectedEvent.sub_events || []).filter(s => String(s.id) !== String(subId))
    const { error } = await supabase.from("events").update({ sub_events: updatedSubEvents }).eq("id", selectedEvent.id)
    if (!error) {
      setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, sub_events: updatedSubEvents } : e))
      setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
    }
  }

  // Import run-of-show: append parsed sub_events to existing event
  const handleImportRunOfShow = async (parsed) => {
    if (!selectedEvent) return
    const updatedSubEvents = [...(selectedEvent.sub_events || []), ...parsed.sub_events]
    const { error } = await supabase.from("events").update({ sub_events: updatedSubEvents }).eq("id", selectedEvent.id)
    if (!error) {
      setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, sub_events: updatedSubEvents } : e))
      setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
    }
    setShowImportModal(false)
  }

  const handleAddItem = async () => {
    if (!itemTime || !itemLabel) return
    const newItem = {
      id: Date.now(), time: itemTime, endTime: itemEndTime,
      startTime: itemTime, adjustedStart: itemTime, adjustedEnd: itemEndTime,
      label: itemLabel, involved: itemInvolved.split(",").map(s => s.trim()).filter(Boolean),
      notes: itemNotes, itemStatus: "upcoming", delayMins: 0
    }
    const updatedSubEvents = (selectedEvent.sub_events || []).map(s =>
      s.id === selectedSub.id ? { ...s, items: [...(s.items || []), newItem] } : s
    )
    const { error } = await supabase.from("events").update({ sub_events: updatedSubEvents }).eq("id", selectedEvent.id)
    if (!error) {
      setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, sub_events: updatedSubEvents } : e))
      setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
      setSelectedSub(prev => ({ ...prev, items: [...(prev.items || []), newItem] }))
    }
    setItemTime(""); setItemEndTime(""); setItemLabel(""); setItemInvolved(""); setItemNotes("")
    setShowItemForm(false)
  }

  const handleEditItem = async (item, updates) => {
    const eventToUpdate = selectedEvent || vendorEvent
    if (!eventToUpdate) return
    const updatedSubEvents = (eventToUpdate.sub_events || []).map(sub => ({
      ...sub,
      items: (sub.items || []).map(it =>
        String(it.id) === String(item.id)
          ? { ...it, ...updates, startTime: updates.time, adjustedStart: updates.time, adjustedEnd: updates.endTime }
          : it
      )
    }))
    await supabase.from("events").update({ sub_events: updatedSubEvents }).eq("id", eventToUpdate.id)
    setEvents(prev => prev.map(e => e.id === eventToUpdate.id ? { ...e, sub_events: updatedSubEvents } : e))
    if (selectedEvent) setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
    if (selectedSub) { const u = updatedSubEvents.find(s => s.id === selectedSub.id); if (u) setSelectedSub(u) }
  }

  const handleDeleteItem = async (item) => {
    const eventToUpdate = selectedEvent || vendorEvent
    if (!eventToUpdate) return
    const updatedSubEvents = (eventToUpdate.sub_events || []).map(sub => ({
      ...sub, items: (sub.items || []).filter(it => String(it.id) !== String(item.id))
    }))
    await supabase.from("events").update({ sub_events: updatedSubEvents }).eq("id", eventToUpdate.id)
    syncEventState(eventToUpdate.id, updatedSubEvents, eventToUpdate.running_delay || 0)
  }

  const cascadeDelay = (items, fromIndex, delayMins) => {
    return items.map((item, i) => {
      if (i < fromIndex) return item
      const origStart = parseTimeToMins(item.startTime || item.time)
      const origEnd = parseTimeToMins(item.endTime || item.time)
      const duration = origEnd - origStart
      const newStart = origStart + delayMins
      return { ...item, adjustedStart: formatMins(newStart), adjustedEnd: formatMins(newStart + duration), delayMins: (item.delayMins || 0) + delayMins }
    })
  }

  const redeemDelay = (items, completedIndex, savedMins, currentRunningDelay) => {
    const redeemed = Math.min(savedMins, currentRunningDelay)
    if (redeemed <= 0) return { items, redeemed: 0 }
    const updatedItems = items.map((item, i) => {
      if (i <= completedIndex) return item
      const currentStart = parseTimeToMins(item.adjustedStart || item.startTime || item.time)
      const origEnd = parseTimeToMins(item.endTime || item.time)
      const origStart = parseTimeToMins(item.startTime || item.time)
      const duration = origEnd - origStart
      const newStart = currentStart - redeemed
      return { ...item, adjustedStart: formatMins(newStart), adjustedEnd: formatMins(newStart + duration), delayMins: Math.max(0, (item.delayMins || 0) - redeemed) }
    })
    return { items: updatedItems, redeemed }
  }

  const handleLogDelay = async (item, mins, reason) => {
    const eventToUpdate = vendorEvent || selectedEvent
    if (!eventToUpdate) return
    const updatedSubEvents = (eventToUpdate.sub_events || []).map(sub => {
      const idx = (sub.items || []).findIndex(i => String(i.id) === String(item.id))
      if (idx === -1) return sub
      return { ...sub, items: cascadeDelay(sub.items, idx, mins) }
    })
    const newRunningDelay = (eventToUpdate.running_delay || 0) + mins
    const healthStatus = newRunningDelay >= 15 ? "bad" : newRunningDelay >= 1 ? "warning" : "good"
    const { error: evtErr } = await supabase.from("events").update({ sub_events: updatedSubEvents, running_delay: newRunningDelay, health_status: healthStatus }).eq("id", eventToUpdate.id)
    if (evtErr) console.warn("handleLogDelay: event update failed", evtErr)
    const { data: delayRow, error: delayErr } = await supabase.from("delays").insert({
      event_id: eventToUpdate.id, item_id: String(item.id), item_label: item.label,
      vendor_name: currentVendor?.name || "Coordinator", vendor_role: currentVendor?.role || "coordinator",
      delay_mins: mins, reason, status: "flagged",
      submitted_at: new Date().toISOString(), reconciliation_status: "open"
    }).select()
    if (delayErr) console.warn("handleLogDelay: delay insert failed — check delays table columns", delayErr)
    if (delayRow?.[0]) {
      setDelayLogs(prev => ({ ...prev, [String(item.id)]: [...(prev[String(item.id)] || []), delayRow[0]] }))
    }
    syncEventState(eventToUpdate.id, updatedSubEvents, newRunningDelay)
  }

  const handleItemStatusChange = async (item, newStatus) => {
    const eventToUpdate = vendorEvent || selectedEvent
    if (!eventToUpdate) return
    let updatedSubEvents = eventToUpdate.sub_events || []
    let newRunningDelay = eventToUpdate.running_delay || 0

    if (newStatus === "completed" || newStatus === "early") {
      const now = nowInMins()
      // FIX: actual_mins = now - adjustedStart (not original startTime)
      // This measures how long the item actually ran from its adjusted (post-delay) start
      const adjustedStartMins = parseTimeToMins(item.adjustedStart || item.startTime || item.time)
      const rawActualMins = now - adjustedStartMins
      const MAX_ACTUAL = 480 // 8 hours cap

      if (rawActualMins > MAX_ACTUAL) {
        console.warn(`handleItemStatusChange: actual_mins (${rawActualMins}) exceeds cap — skipping reconciliation for item ${item.id}`)
      } else {
        const actualMins = Math.max(0, rawActualMins)
        const openDelays = (delayLogs[String(item.id)] || []).filter(d => d.reconciliation_status === "open")
        const totalEstimated = openDelays.reduce((sum, d) => sum + (d.delay_mins || 0), 0)
        const diff = actualMins - totalEstimated
        // Only create reconciliation entry if there are actual delays logged
        if (openDelays.length > 0) {
          const needsReconciliation = Math.abs(diff) >= 2
          const newRecStatus = needsReconciliation ? "pending" : "resolved"
          for (const d of openDelays) {
            await supabase.from("delays").update({
              completed_at: new Date().toISOString(),
              actual_mins: actualMins,
              reconciliation_status: newRecStatus
            }).eq("id", d.id)
          }
          // Update local state for all open delays at once
          setDelayLogs(prev => ({
            ...prev,
            [String(item.id)]: (prev[String(item.id)] || []).map(x =>
              openDelays.some(d => d.id === x.id)
                ? { ...x, completed_at: new Date().toISOString(), actual_mins: actualMins, reconciliation_status: newRecStatus }
                : x
            )
          }))
        }
      }

      // Redemption: if finished before adjustedEnd, recover time
      const adjustedEndMins = parseTimeToMins(item.adjustedEnd || item.endTime || item.time)
      const savedMins = adjustedEndMins - now
      if (savedMins > 0 && newRunningDelay > 0) {
        updatedSubEvents = updatedSubEvents.map(sub => {
          const idx = (sub.items || []).findIndex(i => String(i.id) === String(item.id))
          if (idx === -1) return sub
          const { items: redeemedItems, redeemed } = redeemDelay(sub.items, idx, savedMins, newRunningDelay)
          newRunningDelay = Math.max(0, newRunningDelay - redeemed)
          return { ...sub, items: redeemedItems.map((it, i) => i === idx ? { ...it, itemStatus: newStatus } : it) }
        })
      } else {
        updatedSubEvents = updatedSubEvents.map(sub => ({
          ...sub, items: (sub.items || []).map(it => String(it.id) === String(item.id) ? { ...it, itemStatus: newStatus } : it)
        }))
      }
    } else {
      updatedSubEvents = updatedSubEvents.map(sub => ({
        ...sub, items: (sub.items || []).map(it => String(it.id) === String(item.id) ? { ...it, itemStatus: newStatus } : it)
      }))
    }

    const healthStatus = newRunningDelay >= 15 ? "bad" : newRunningDelay >= 1 ? "warning" : "good"
    await supabase.from("events").update({ sub_events: updatedSubEvents, running_delay: newRunningDelay, health_status: healthStatus }).eq("id", eventToUpdate.id)
    if (currentVendor) {
      await supabase.from("item_activity").insert({
        event_id: eventToUpdate.id, item_id: String(item.id), item_label: item.label,
        vendor_id: currentVendor.dbId || null, vendor_name: currentVendor.name,
        vendor_role: currentVendor.role, action: newStatus, delay_mins: 0
      })
    }
    syncEventState(eventToUpdate.id, updatedSubEvents, newRunningDelay)
  }

  const handleApproveReconciliation = async (delayRecord) => {
    const eventToUpdate = selectedEvent || vendorEvent
    if (!eventToUpdate) return
    const diff = (delayRecord.actual_mins || 0) - delayRecord.delay_mins
    let updatedSubEvents = eventToUpdate.sub_events || []
    let newRunningDelay = eventToUpdate.running_delay || 0
    if (diff !== 0) {
      updatedSubEvents = updatedSubEvents.map(sub => {
        const idx = (sub.items || []).findIndex(i => String(i.id) === String(delayRecord.item_id))
        if (idx === -1) return sub
        return { ...sub, items: cascadeDelay(sub.items, idx + 1, diff) }
      })
      newRunningDelay = Math.max(0, newRunningDelay + diff)
    }
    await supabase.from("delays").update({ reconciliation_status: "approved" }).eq("id", delayRecord.id)
    await supabase.from("events").update({ sub_events: updatedSubEvents, running_delay: newRunningDelay }).eq("id", eventToUpdate.id)
    setDelayLogs(prev => ({ ...prev, [delayRecord.item_id]: (prev[delayRecord.item_id] || []).map(x => x.id === delayRecord.id ? { ...x, reconciliation_status: "approved" } : x) }))
    syncEventState(eventToUpdate.id, updatedSubEvents, newRunningDelay)
  }

  const handleDeclineReconciliation = async (delayRecord) => {
    await supabase.from("delays").update({ reconciliation_status: "declined" }).eq("id", delayRecord.id)
    setDelayLogs(prev => ({ ...prev, [delayRecord.item_id]: (prev[delayRecord.item_id] || []).map(x => x.id === delayRecord.id ? { ...x, reconciliation_status: "declined" } : x) }))
  }

  const syncEventState = (eventId, updatedSubEvents, newRunningDelay) => {
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, sub_events: updatedSubEvents, running_delay: newRunningDelay } : e))
    if (vendorEvent?.id === eventId) setVendorEvent(prev => ({ ...prev, sub_events: updatedSubEvents, running_delay: newRunningDelay }))
    if (selectedEvent?.id === eventId) setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents, running_delay: newRunningDelay }))
    if (selectedSub) { const u = updatedSubEvents.find(s => s.id === selectedSub.id); if (u) setSelectedSub(u) }
  }

  const handleCaughtUp = async () => {
    const eventToUpdate = selectedEvent || vendorEvent
    if (!eventToUpdate) return
    const resetSubEvents = (eventToUpdate.sub_events || []).map(sub => ({
      ...sub, items: (sub.items || []).map(item => ({ ...item, adjustedStart: item.startTime || item.time, adjustedEnd: item.endTime, delayMins: 0 }))
    }))
    await supabase.from("events").update({ sub_events: resetSubEvents, running_delay: 0, health_status: "good" }).eq("id", eventToUpdate.id)
    syncEventState(eventToUpdate.id, resetSubEvents, 0)
    setNotifications(prev => [{ id: Date.now(), msg: "✅ Schedule reset — back on track!", type: "good" }, ...prev].slice(0, 5))
  }

  const handleAddVendor = async () => {
    if (!newVendorName || !newVendorRole || !newVendorPin || !selectedEvent) return
    const role = VENDOR_ROLES.find(r => r.key === newVendorRole)
    const { data, error } = await supabase.from("event_vendors").insert({
      event_id: selectedEvent.id, name: newVendorName, role: newVendorRole, pin: newVendorPin,
      color: role?.color, coordinator_tier: newVendorRole === "coordinator" ? newVendorTier : null
    }).select()
    if (!error) {
      setEventVendors(prev => [...prev, data[0]])
      setNewVendorName(""); setNewVendorRole(""); setNewVendorPin(""); setNewVendorTier("")
    }
  }

  const handleSaveVendorEdit = async () => {
    if (!editingVendor) return
    const role = VENDOR_ROLES.find(r => r.key === editVendorRole)
    const { error } = await supabase.from("event_vendors").update({
      name: editVendorName, role: editVendorRole, pin: editVendorPin,
      color: role?.color, coordinator_tier: editVendorRole === "coordinator" ? editVendorTier : null
    }).eq("id", editingVendor.id)
    if (error) console.warn("handleSaveVendorEdit: update failed — check event_vendors.coordinator_tier column", error)
    if (!error) {
      setEventVendors(prev => prev.map(v => v.id === editingVendor.id
        ? { ...v, name: editVendorName, role: editVendorRole, pin: editVendorPin, color: role?.color, coordinator_tier: editVendorRole === "coordinator" ? editVendorTier : null }
        : v
      ))
      setEditingVendor(null)
    }
  }

  const handlePinJoin = async () => {
    if (!selectedVendorForPin || !pinInput) return
    if (pinInput === selectedVendorForPin.pin) {
      const tier = selectedVendorForPin.coordinator_tier || null
      const roleLabel = VENDOR_ROLES.find(r => r.key === selectedVendorForPin.role)?.label
      const tierLabel = tier === "lead" ? "Lead Coordinator" : tier === "assistant" ? "Assistant Coordinator" : roleLabel
      // coordinatorTier is stored in vendor object and persisted to localStorage
      const vendor = {
        name: selectedVendorForPin.name,
        role: selectedVendorForPin.role,
        color: selectedVendorForPin.color,
        label: tierLabel,
        dbId: selectedVendorForPin.id,
        coordinatorTier: tier,  // ← critical: must be present for isLead() to work
      }
      localStorage.setItem(`eventflow_vendor_${vendorEvent.id}`, JSON.stringify(vendor))
      await supabase.from("event_vendors").update({ checked_in: true, checked_in_at: new Date().toISOString() }).eq("id", selectedVendorForPin.id)
      setCurrentVendor(vendor)
      setEventVendors(prev => prev.map(v => v.id === selectedVendorForPin.id ? { ...v, checked_in: true } : v))
      setScreen("vendor-timeline")
      setPinError("")
    } else {
      setPinError("Incorrect PIN. Please try again.")
    }
  }

  // ── NOTIFICATION BANNER ───────────────────────────────────────
  const NotificationBanner = () => {
    if (notifications.length === 0) return null
    const latest = notifications[0]
    return (
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 999, background: latest.type === "delay" ? "rgba(248,113,113,0.95)" : "rgba(52,211,153,0.95)", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", backdropFilter: "blur(8px)" }}>
        <span style={{ color: "#fff", fontFamily: "Georgia", fontSize: 13 }}>{latest.msg}</span>
        <button onClick={() => setNotifications(prev => prev.slice(1))} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>
      </div>
    )
  }

  // ── SHARED ITEM LIST RENDERER ─────────────────────────────────
  const renderItemList = (items, showFilter = false, isBackend = false) => {
    // Re-read time fresh each render — highlighting stays current
    const now = nowInMins()
    const sorted = [...items].sort((a, b) => parseTimeToMins(a.startTime || a.time) - parseTimeToMins(b.startTime || b.time))

    const filtered = showFilter && vendorFilter !== "All"
      ? sorted.filter(item => {
          const s = item.itemStatus || "upcoming"
          if (vendorFilter === "Upcoming") return s === "upcoming"
          if (vendorFilter === "In Progress") return s === "inprogress"
          if (vendorFilter === "Delayed") return s === "delayed"
          if (vendorFilter === "Completed") return s === "completed" || s === "early"
          return true
        })
      : sorted

    let nowIndex = -1
    sorted.forEach((item, i) => {
      const start = parseTimeToMins(item.adjustedStart || item.startTime || item.time)
      if (start === 0) return // skip items with unparseable times
      // Prefer adjustedEnd > endTime. If missing or equals start,
      // fall back to next item start so window is always valid.
      const rawEnd = parseTimeToMins(item.adjustedEnd || item.endTime || "")
      const nextStart = i < sorted.length - 1
        ? parseTimeToMins(sorted[i + 1].adjustedStart || sorted[i + 1].startTime || sorted[i + 1].time)
        : start + 60 // last item: 60-min window
      const end = rawEnd > start ? rawEnd : nextStart
      if (now >= start && now < end) nowIndex = i
    })
    const nowItemId = nowIndex >= 0 ? sorted[nowIndex]?.id : null

    return (
      <>
        {showFilter && (
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            {["All", "Upcoming", "In Progress", "Delayed", "Completed"].map(f => (
              <button key={f} onClick={() => setVendorFilter(f)} style={{
                padding: "4px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "Georgia", fontSize: 11,
                background: vendorFilter === f ? "rgba(192,132,252,0.18)" : "transparent",
                border: `1px solid ${vendorFilter === f ? "#c084fc" : "#e5e7eb"}`,
                color: vendorFilter === f ? "#c084fc" : "#475569"
              }}>{f}</button>
            ))}
            {nowItemId && (
              <button onClick={() => nowItemRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                style={{ padding: "4px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "Georgia", fontSize: 11, background: "rgba(192,132,252,0.08)", border: "1px solid rgba(192,132,252,0.3)", color: "#7c3aed", marginLeft: "auto" }}>
                📍 Jump to Now
              </button>
            )}
          </div>
        )}
        {!showFilter && nowItemId && (
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => nowItemRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
              style={{ padding: "4px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "Georgia", fontSize: 11, background: "rgba(192,132,252,0.08)", border: "1px solid rgba(192,132,252,0.3)", color: "#7c3aed" }}>
              📍 Jump to Now
            </button>
          </div>
        )}
        {(() => {
          // Group items by subLabel to insert dividers between sub-events
          let lastSubLabel = null
          return filtered.map(item => {
            const isNow = String(item.id) === String(nowItemId)
            const showDivider = item.subLabel && item.subLabel !== lastSubLabel
            lastSubLabel = item.subLabel
            return (
              <div key={item.id}>
                {showDivider && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 14px" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.subColor, flexShrink: 0, marginLeft: 97 }} />
                    <div style={{ flex: 1, height: 1, background: item.subColor, opacity: 0.3 }} />
                    <span style={{ color: item.subColor, fontFamily: "Georgia", fontSize: 11, fontWeight: 700, letterSpacing: 2, whiteSpace: "nowrap", textTransform: "uppercase" }}>{item.subLabel}</span>
                    <div style={{ flex: 1, height: 1, background: item.subColor, opacity: 0.3 }} />
                  </div>
                )}
                <VendorItemCard
                  item={item}
                  currentVendor={currentVendor}
                  onLogDelay={handleLogDelay}
                  onStatusChange={handleItemStatusChange}
                  onEditItem={handleEditItem}
                  onDeleteItem={handleDeleteItem}
                  onApproveReconciliation={handleApproveReconciliation}
                  onDeclineReconciliation={handleDeclineReconciliation}
                  delayLogs={delayLogs}
                  isNow={isNow}
                  itemRef={isNow ? nowItemRef : null}
                  isBackend={isBackend}
                />
              </div>
            )
          })
        })()}
      </>
    )
  }

  // ── SCREEN: VENDOR JOIN ───────────────────────────────────────
  if (screen === "vendor-join" && vendorEvent) {
    return (
      <div style={{ background: "#f8f7f4", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 440 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "inline-block", background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.2)", borderRadius: 8, padding: "6px 16px", marginBottom: 16 }}>
              <span style={{ color: "#7c3aed", fontSize: 11, letterSpacing: 2 }}>YOU'RE INVITED</span>
            </div>
            <h1 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 28, margin: "0 0 6px" }}>{vendorEvent.event_name}</h1>
            <p style={{ color: "#7c3aed", fontFamily: "Georgia", fontSize: 15, margin: "0 0 4px" }}>{vendorEvent.client_name}</p>
            <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{vendorEvent.event_date} · {vendorEvent.venue}</p>
          </div>
          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 28 }}>
            {!selectedVendorForPin ? (
              <>
                <p style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 16px" }}>SELECT YOUR NAME</p>
                {eventVendors.length === 0 ? (
                  <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No vendors added yet. Contact your coordinator.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {eventVendors.map(v => {
                      const role = VENDOR_ROLES.find(r => r.key === v.role)
                      const tierLabel = v.coordinator_tier === "lead" ? "Lead Coordinator" : v.coordinator_tier === "assistant" ? "Assistant Coordinator" : null
                      return (
                        <button key={v.id} onClick={() => { setSelectedVendorForPin(v); setPinInput(""); setPinError("") }}
                          style={{ padding: "12px 16px", borderRadius: 10, cursor: "pointer", background: "#f8f7f4", border: `1px solid ${role?.color || "#e5e7eb"}20`, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "Georgia" }}>
                          <div style={{ textAlign: "left" }}>
                            <p style={{ color: "#1a1a2e", fontSize: 14, margin: "0 0 2px" }}>{v.name}</p>
                            <p style={{ color: role?.color || "#475569", fontSize: 11, margin: 0 }}>{tierLabel || role?.label}</p>
                          </div>
                          {v.checked_in && <span style={{ color: "#34d399", fontSize: 11 }}>✓ Checked in</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <button onClick={() => { setSelectedVendorForPin(null); setPinError("") }} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0, marginBottom: 16 }}>← Back</button>
                <p style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 16, margin: "0 0 4px" }}>{selectedVendorForPin.name}</p>
                <p style={{ color: VENDOR_ROLES.find(r => r.key === selectedVendorForPin.role)?.color, fontFamily: "Georgia", fontSize: 12, margin: "0 0 20px" }}>
                  {selectedVendorForPin.coordinator_tier === "lead" ? "Lead Coordinator"
                    : selectedVendorForPin.coordinator_tier === "assistant" ? "Assistant Coordinator"
                    : VENDOR_ROLES.find(r => r.key === selectedVendorForPin.role)?.label}
                </p>
                <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 8, fontFamily: "Georgia" }}>ENTER YOUR PIN</label>
                <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePinJoin()}
                  placeholder="••••" maxLength={6}
                  style={{ width: "100%", background: "#f8f7f4", border: `1px solid ${pinError ? "#f87171" : "#e5e7eb"}`, borderRadius: 8, color: "#1a1a2e", fontSize: 18, padding: "12px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box", textAlign: "center", letterSpacing: 6, marginBottom: 8 }} />
                {pinError && <p style={{ color: "#f87171", fontSize: 12, fontFamily: "Georgia", margin: "0 0 8px" }}>{pinError}</p>}
                <button onClick={handlePinJoin} style={{ width: "100%", padding: "13px", background: pinInput ? "#7c3aed" : "#e5e7eb", border: "none", borderRadius: 8, color: pinInput ? "#ffffff" : "#9ca3af", fontSize: 15, fontWeight: 700, cursor: pinInput ? "pointer" : "default", fontFamily: "Georgia" }}>Join Event →</button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── SCREEN: VENDOR TIMELINE ───────────────────────────────────
  if (screen === "vendor-timeline" && currentVendor && vendorEvent) {
    const coordinator = isCoord(currentVendor)
    const lead = isLead(currentVendor)
    const allItems = (vendorEvent.sub_events || []).flatMap(sub =>
      (sub.items || []).map(item => ({ ...item, subLabel: sub.label, subColor: sub.color, subTime: sub.startTime }))
    )
    const myItems = coordinator ? allItems : allItems.filter(item =>
      item.involved && item.involved.some(p =>
        p.toLowerCase().includes(currentVendor.role.toLowerCase()) ||
        p.toLowerCase().includes((currentVendor.label || "").toLowerCase())
      )
    )
    const skippedCount = allItems.filter(i => i.itemStatus === "skipped").length

    return (
      <div style={{ background: "#f8f7f4", minHeight: "100vh", padding: 24, paddingTop: notifications.length > 0 ? 60 : 24 }}>
        <NotificationBanner />
        <div style={{ maxWidth: 680, margin: "0 auto" }}>

          {/* Top bar with clock */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <LiveClock />
            {lead && vendorEvent.running_delay > 0 && (
              <button onClick={handleCaughtUp} style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, color: "#34d399", fontSize: 11, fontFamily: "Georgia", padding: "5px 12px", cursor: "pointer" }}>✓ We're Caught Up</button>
            )}
          </div>

          <div style={{ background: "#ffffff", border: `1px solid ${currentVendor.color}30`, borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 18, margin: "0 0 2px" }}>{vendorEvent.event_name}</h2>
              <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{vendorEvent.event_date} · {vendorEvent.venue}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ background: `${currentVendor.color}10`, border: `1.5px solid ${currentVendor.color}50`, borderRadius: 12, padding: "6px 14px", marginBottom: 6 }}>
                <p style={{ color: currentVendor.color, fontSize: 12, fontFamily: "Georgia", margin: "0 0 1px", fontWeight: 700 }}>{currentVendor.name}</p>
                <p style={{ color: currentVendor.color, fontSize: 10, fontFamily: "Georgia", margin: 0, opacity: 0.7 }}>{currentVendor.label}</p>
              </div>
              <button onClick={() => { localStorage.removeItem(`eventflow_vendor_${vendorEvent.id}`); setCurrentVendor(null); setScreen("vendor-join") }}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontFamily: "Georgia", fontSize: 11, padding: 0 }}>Not you?</button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <HealthTracker runningDelay={vendorEvent.running_delay || 0} skippedCount={skippedCount} />
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {(vendorEvent.sub_events || []).map(sub => (
              <div key={sub.id} style={{ background: `${sub.color}15`, border: `1.5px solid ${sub.color}40`, borderRadius: 20, padding: "4px 12px" }}>
                <span style={{ color: sub.color, fontSize: 11, fontFamily: "Georgia" }}>{sub.label}</span>
              </div>
            ))}
          </div>

          <p style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 14px" }}>
            {coordinator ? "ALL ITEMS" : "YOUR ITEMS"} — {myItems.length} tasks
          </p>

          {myItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280", fontFamily: "Georgia", fontSize: 14, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
              No items assigned to {currentVendor.label} yet.
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 88, top: 0, bottom: 0, width: 1, background: "#e5e7eb" }} />
              {renderItemList(myItems, !coordinator)}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── SCREEN: CREATE EVENT ──────────────────────────────────────
  if (screen === "create") {
    return (
      <div style={{ background: "#f8f7f4", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 480, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 32 }}>
          <div style={{ marginBottom: 32 }}>
            <button onClick={() => setScreen("dashboard")} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0, marginBottom: 16 }}>← Back</button>
            <h1 style={{ color: "#7c3aed", fontFamily: "Georgia", fontSize: 28, margin: "0 0 6px" }}>New Event</h1>
            <p style={{ color: "#6b7280", fontSize: 13, margin: 0, fontFamily: "Georgia" }}>Fill in the details to get started</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[
              { label: "EVENT NAME *", value: eventName, setter: setEventName, placeholder: "e.g. The Josephs Wedding" },
              { label: "CLIENT NAME *", value: clientName, setter: setClientName, placeholder: "e.g. Deborah & Nifemi" },
              { label: "VENUE", value: venue, setter: setVenue, placeholder: "e.g. Trinity Event Center, Houston TX" },
              { label: "HASHTAG", value: hashtag, setter: setHashtag, placeholder: "e.g. #ForeverJoseph" },
            ].map(field => (
              <div key={field.label}>
                <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>{field.label}</label>
                <input value={field.value} onChange={e => field.setter(e.target.value)} placeholder={field.placeholder}
                  style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
              </div>
            ))}
            <div>
              <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>EVENT DATE *</label>
              <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
                style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleCreate} style={{ marginTop: 8, width: "100%", padding: "13px", background: eventName && clientName && eventDate ? "#c084fc" : "#e5e7eb", border: "none", borderRadius: 8, color: eventName && clientName && eventDate ? "#ffffff" : "#9ca3af", fontSize: 15, fontWeight: 700, cursor: eventName && clientName && eventDate ? "pointer" : "default", fontFamily: "Georgia", transition: "all 0.2s" }}>Create Event →</button>
          </div>
        </div>
      </div>
    )
  }

  // ── SCREEN: TIMELINE VIEW ─────────────────────────────────────
  if (selectedSub && selectedEvent) {
    const skippedCount = (selectedSub.items || []).filter(i => i.itemStatus === "skipped").length
    return (
      <div style={{ background: "#f8f7f4", minHeight: "100vh", padding: 32, paddingTop: notifications.length > 0 ? 72 : 32 }}>
        <NotificationBanner />
        <div style={{ maxWidth: 760, margin: "0 auto" }}>

          {/* Clock row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setSelectedSub(null)} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0 }}>← {selectedEvent.event_name}</button>
              <span style={{ color: "#d1d5db", fontSize: 13 }}>/</span>
              <span style={{ color: selectedSub.color, fontFamily: "Georgia", fontSize: 13 }}>{selectedSub.label}</span>
            </div>
            <LiveClock />
          </div>

          <div style={{ background: "#ffffff", borderLeft: `4px solid ${selectedSub.color}`, border: `1px solid ${selectedSub.color}30`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h1 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 24, margin: "0 0 6px" }}>{selectedSub.label}</h1>
                <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{selectedSub.venue} · Starts {selectedSub.startTime}</p>
              </div>
              <div style={{ background: `${selectedSub.color}18`, border: `1px solid ${selectedSub.color}40`, borderRadius: 20, padding: "4px 14px" }}>
                <span style={{ color: selectedSub.color, fontSize: 12, fontFamily: "Georgia", letterSpacing: 1 }}>{selectedSub.startTime}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <HealthTracker runningDelay={selectedEvent.running_delay || 0} skippedCount={skippedCount} />
              {selectedEvent.running_delay > 0 && (
                <button onClick={handleCaughtUp} style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, color: "#34d399", fontSize: 11, fontFamily: "Georgia", padding: "5px 12px", cursor: "pointer" }}>✓ Caught Up</button>
              )}
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 16px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 2px" }}>VENDOR SHARE LINK</p>
              <p style={{ color: "#6b7280", fontSize: 12, fontFamily: "Georgia", margin: 0 }}>{window.location.origin}/?event={selectedEvent.id}</p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?event=${selectedEvent.id}`); alert("Link copied!") }}
              style={{ background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 6, color: "#7c3aed", fontSize: 11, fontFamily: "Georgia", padding: "6px 12px", cursor: "pointer" }}>Copy Link</button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 18, margin: 0 }}>Timeline</h2>
            <button onClick={() => setShowItemForm(!showItemForm)} style={{ background: showItemForm ? "#f3f4f6" : selectedSub.color, border: "none", borderRadius: 8, color: showItemForm ? "#6b7280" : "#ffffff", fontSize: 12, fontWeight: 700, padding: "7px 14px", cursor: "pointer", fontFamily: "Georgia" }}>
              {showItemForm ? "Cancel" : "+ Add Item"}
            </button>
          </div>

          {showItemForm && (
            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <p style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 16px" }}>NEW TIMELINE ITEM</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  {[{ label: "START TIME *", value: itemTime, setter: setItemTime, placeholder: "e.g. 9:00 AM" }, { label: "END TIME", value: itemEndTime, setter: setItemEndTime, placeholder: "e.g. 9:15 AM" }].map(f => (
                    <div key={f.label} style={{ flex: 1 }}>
                      <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>{f.label}</label>
                      <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                        style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                    </div>
                  ))}
                </div>
                <div>
                  <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>ACTIVITY *</label>
                  <input value={itemLabel} onChange={e => setItemLabel(e.target.value)} placeholder="e.g. Guest Arrival & Seating"
                    style={{ width: "100%", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 8, fontFamily: "Georgia" }}>PARTIES INVOLVED</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {VENDOR_ROLES.map(role => {
                      const currentList = itemInvolved.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
                      const selected = currentList.includes(role.label.toLowerCase())
                      return (
                        <button key={role.key} type="button" onClick={() => {
                          const current = itemInvolved.split(",").map(s => s.trim()).filter(Boolean)
                          const idx = current.findIndex(c => c.toLowerCase() === role.label.toLowerCase())
                          if (idx >= 0) { current.splice(idx, 1) } else { current.push(role.label) }
                          setItemInvolved(current.join(", "))
                        }} style={{
                          padding: "5px 13px", borderRadius: 20, cursor: "pointer", fontFamily: "Georgia", fontSize: 11,
                          background: selected ? role.color : "#ffffff",
                          border: `1.5px solid ${selected ? role.color : "#d1d5db"}`,
                          color: selected ? "#ffffff" : "#374151",
                          fontWeight: selected ? 700 : 400, transition: "all 0.15s"
                        }}>{role.label}</button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>NOTES</label>
                  <textarea value={itemNotes} onChange={e => setItemNotes(e.target.value)} placeholder="Any instructions, cues, or details..."
                    style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box", resize: "vertical", minHeight: 72 }} />
                </div>
                <button onClick={handleAddItem} style={{ width: "100%", padding: "11px", background: itemTime && itemLabel ? selectedSub.color : "#e5e7eb", border: "none", borderRadius: 8, color: itemTime && itemLabel ? "#ffffff" : "#9ca3af", fontSize: 13, fontWeight: 700, cursor: itemTime && itemLabel ? "pointer" : "default", fontFamily: "Georgia", transition: "all 0.2s" }}>Add to Timeline →</button>
              </div>
            </div>
          )}

          {(!selectedSub.items || selectedSub.items.length === 0) ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280", fontFamily: "Georgia", fontSize: 14, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}>No timeline items yet.</div>
          ) : (
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 88, top: 0, bottom: 0, width: 1, background: "#e5e7eb" }} />
              {renderItemList(selectedSub.items.map(item => ({ ...item, subLabel: selectedSub.label, subColor: selectedSub.color })), false, true)}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── SCREEN: EVENT DETAIL ──────────────────────────────────────
  if (selectedEvent) {
    return (
      <div style={{ background: "#f8f7f4", minHeight: "100vh", padding: 32 }}>
        <NotificationBanner />
        {showImportModal && (
          <ImportModal onClose={() => setShowImportModal(false)} onImport={handleImportRunOfShow} />
        )}
        <div style={{ maxWidth: 700, margin: "0 auto" }}>

          {/* Top bar with clock */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <button onClick={() => { setSelectedEvent(null); setShowSubEventForm(false); setShowVendorManager(false) }}
              style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0 }}>← All Events</button>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <LiveClock />
              <button onClick={() => handleDeleteEvent(selectedEvent.id)}
                style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 7, color: "#ef4444", fontSize: 11, fontFamily: "Georgia", padding: "6px 12px", cursor: "pointer" }}>
                🗑 Delete Event
              </button>
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h1 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 26, margin: "0 0 4px" }}>{selectedEvent.event_name}</h1>
                <p style={{ color: "#7c3aed", fontFamily: "Georgia", fontSize: 15, margin: "0 0 4px" }}>{selectedEvent.client_name}</p>
                <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{selectedEvent.event_date} · {selectedEvent.venue}</p>
              </div>
              <StatusTag status={selectedEvent.status} onChange={(s) => { handleStatusChange(selectedEvent.id, s); setSelectedEvent(prev => ({ ...prev, status: s })) }} />
            </div>
            {selectedEvent.hashtag && <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 13, margin: "0 0 12px" }}>{selectedEvent.hashtag}</p>}
            <div style={{ background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 2px" }}>VENDOR LINK</p>
                <p style={{ color: "#6b7280", fontSize: 11, fontFamily: "Georgia", margin: 0 }}>{window.location.origin}/?event={selectedEvent.id}</p>
              </div>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/?event=${selectedEvent.id}`); alert("Copied!") }}
                style={{ background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 6, color: "#7c3aed", fontSize: 11, fontFamily: "Georgia", padding: "5px 10px", cursor: "pointer" }}>Copy</button>
            </div>
          </div>

          {/* Vendor Manager */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 18, margin: 0 }}>Vendor Team</h2>
              <button onClick={() => setShowVendorManager(!showVendorManager)} style={{ background: showVendorManager ? "#e5e7eb" : "rgba(192,132,252,0.1)", border: `1px solid ${showVendorManager ? "#e5e7eb" : "rgba(192,132,252,0.3)"}`, borderRadius: 8, color: showVendorManager ? "#475569" : "#c084fc", fontSize: 12, fontWeight: 700, padding: "7px 14px", cursor: "pointer", fontFamily: "Georgia" }}>
                {showVendorManager ? "Close" : "+ Add Vendor"}
              </button>
            </div>

            {eventVendors.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: showVendorManager ? 12 : 0 }}>
                {eventVendors.map(v => {
                  const role = VENDOR_ROLES.find(r => r.key === v.role)
                  const tierLabel = v.coordinator_tier === "lead" ? "Lead Coordinator" : v.coordinator_tier === "assistant" ? "Assistant Coordinator" : null
                  const isEditingThis = editingVendor?.id === v.id
                  return (
                    <div key={v.id} style={{ background: "#ffffff", border: `1px solid ${role?.color || "#e5e7eb"}20`, borderRadius: 8, padding: "10px 14px" }}>
                      {isEditingThis ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <input value={editVendorName} onChange={e => setEditVendorName(e.target.value)}
                            style={{ background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 6, color: "#1a1a2e", fontSize: 13, padding: "7px 10px", outline: "none", fontFamily: "Georgia" }} />
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                            {VENDOR_ROLES.map(r => (
                              <button key={r.key} onClick={() => setEditVendorRole(r.key)} style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: editVendorRole === r.key ? `${r.color}18` : "#f9fafb", border: `1.5px solid ${editVendorRole === r.key ? r.color : "#d1d5db"}`, color: editVendorRole === r.key ? r.color : "#374151", fontSize: 11, fontFamily: "Georgia" }}>{r.label}</button>
                            ))}
                          </div>
                          {editVendorRole === "coordinator" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                              {COORDINATOR_TIERS.map(t => (
                                <button key={t.key} onClick={() => setEditVendorTier(t.key)} style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: editVendorTier === t.key ? `${t.color}18` : "#f9fafb", border: `1.5px solid ${editVendorTier === t.key ? t.color : "#d1d5db"}`, color: editVendorTier === t.key ? t.color : "#374151", fontSize: 11, fontFamily: "Georgia" }}>{t.label}</button>
                              ))}
                            </div>
                          )}
                          <input value={editVendorPin} onChange={e => setEditVendorPin(e.target.value)} placeholder="New PIN" type="number" maxLength={6}
                            style={{ background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 6, color: "#1a1a2e", fontSize: 13, padding: "7px 10px", outline: "none", fontFamily: "Georgia" }} />
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={handleSaveVendorEdit} style={{ flex: 2, padding: "7px", background: "rgba(192,132,252,0.12)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 6, color: "#7c3aed", fontSize: 12, fontFamily: "Georgia", cursor: "pointer", fontWeight: 700 }}>Save</button>
                            <button onClick={() => setEditingVendor(null)} style={{ flex: 1, padding: "7px", background: "transparent", border: "1px solid #e5e7eb", borderRadius: 6, color: "#4b5563", fontSize: 12, fontFamily: "Georgia", cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <span style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 13 }}>{v.name}</span>
                            <span style={{ color: role?.color, fontFamily: "Georgia", fontSize: 11, marginLeft: 8 }}>{tierLabel || role?.label}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 11 }}>PIN: {v.pin}</span>
                            {v.checked_in && <span style={{ color: "#34d399", fontSize: 11 }}>✓ In</span>}
                            <button onClick={() => { setEditingVendor(v); setEditVendorName(v.name); setEditVendorRole(v.role); setEditVendorPin(v.pin); setEditVendorTier(v.coordinator_tier || "") }}
                              style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 5, color: "#60a5fa", fontSize: 10, fontFamily: "Georgia", padding: "3px 8px", cursor: "pointer" }}>✏ Edit</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {showVendorManager && (
              <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
                <p style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 14px" }}>ADD VENDOR</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} placeholder="Vendor name e.g. Joseph Babalola"
                    style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {VENDOR_ROLES.map(role => (
                      <button key={role.key} onClick={() => setNewVendorRole(role.key)} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: newVendorRole === role.key ? `${role.color}18` : "#f9fafb", border: `1.5px solid ${newVendorRole === role.key ? role.color : "#d1d5db"}`, color: newVendorRole === role.key ? role.color : "#374151", fontSize: 12, fontFamily: "Georgia", textAlign: "left" }}>{role.label}</button>
                    ))}
                  </div>
                  {newVendorRole === "coordinator" && (
                    <div>
                      <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>COORDINATOR TIER</label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {COORDINATOR_TIERS.map(tier => (
                          <button key={tier.key} onClick={() => setNewVendorTier(tier.key)} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: newVendorTier === tier.key ? `${tier.color}18` : "#f9fafb", border: `1.5px solid ${newVendorTier === tier.key ? tier.color : "#d1d5db"}`, color: newVendorTier === tier.key ? tier.color : "#374151", fontSize: 12, fontFamily: "Georgia", textAlign: "left" }}>{tier.label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>PIN (numbers only)</label>
                    <input value={newVendorPin} onChange={e => setNewVendorPin(e.target.value)} placeholder="e.g. 1234" maxLength={6} type="number"
                      style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                  </div>
                  <button onClick={handleAddVendor} style={{ width: "100%", padding: "11px", background: newVendorName && newVendorRole && newVendorPin ? "#c084fc" : "#e5e7eb", border: "none", borderRadius: 8, color: newVendorName && newVendorRole && newVendorPin ? "#ffffff" : "#9ca3af", fontSize: 13, fontWeight: 700, cursor: newVendorName && newVendorRole && newVendorPin ? "pointer" : "default", fontFamily: "Georgia" }}>Add to Team →</button>
                </div>
              </div>
            )}
          </div>

          {/* Sub-events header with import button */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 18, margin: 0 }}>Sub-Events</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowImportModal(true)} style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 8, color: "#60a5fa", fontSize: 12, fontWeight: 700, padding: "7px 14px", cursor: "pointer", fontFamily: "Georgia" }}>📄 Import Run-of-Show</button>
              <button onClick={() => setShowSubEventForm(!showSubEventForm)} style={{ background: showSubEventForm ? "#f3f4f6" : "#7c3aed", border: "none", borderRadius: 8, color: showSubEventForm ? "#6b7280" : "#ffffff", fontSize: 12, fontWeight: 700, padding: "7px 14px", cursor: "pointer", fontFamily: "Georgia" }}>
                {showSubEventForm ? "Cancel" : "+ Add Sub-Event"}
              </button>
            </div>
          </div>

          {showSubEventForm && (
            <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <p style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 16px" }}>NEW SUB-EVENT</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "NAME *", value: subLabel, setter: setSubLabel, placeholder: "e.g. Traditional Wedding" },
                  { label: "VENUE", value: subVenue, setter: setSubVenue, placeholder: "e.g. Trinity Event Center" },
                  { label: "START TIME *", value: subStartTime, setter: setSubStartTime, placeholder: "e.g. 9:00 AM" },
                ].map(f => (
                  <div key={f.label}>
                    <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>{f.label}</label>
                    <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                      style={{ width: "100%", background: "#f8f7f4", border: "1px solid #e5e7eb", borderRadius: 8, color: "#1a1a2e", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                  </div>
                ))}
                <div>
                  <label style={{ color: "#4b5563", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 8, fontFamily: "Georgia" }}>COLOR</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {PHASE_COLORS.map(c => (
                      <div key={c.value} onClick={() => setSubColor(c.value)} style={{ width: 28, height: 28, borderRadius: "50%", background: c.value, cursor: "pointer", border: subColor === c.value ? "3px solid white" : "3px solid transparent", boxSizing: "border-box" }} />
                    ))}
                  </div>
                </div>
                <div style={{ background: `${subColor}10`, border: `1px solid ${subColor}30`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 3, height: 32, borderRadius: 2, background: subColor }} />
                  <div>
                    <p style={{ color: "#1a1a2e", fontFamily: "Georgia", fontSize: 14, margin: "0 0 2px" }}>{subLabel || "Sub-event name"}</p>
                    <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{subVenue || "Venue"} · {subStartTime || "Start time"}</p>
                  </div>
                </div>
                <button onClick={handleAddSubEvent} style={{ width: "100%", padding: "11px", background: subLabel && subStartTime ? subColor : "#e5e7eb", border: "none", borderRadius: 8, color: subLabel && subStartTime ? "#ffffff" : "#9ca3af", fontSize: 13, fontWeight: 700, cursor: subLabel && subStartTime ? "pointer" : "default", fontFamily: "Georgia", transition: "all 0.2s" }}>Add Sub-Event →</button>
              </div>
            </div>
          )}

          {(!selectedEvent.sub_events || selectedEvent.sub_events.length === 0) ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280", fontFamily: "Georgia", fontSize: 14, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12 }}>No sub-events yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedEvent.sub_events.map(sub => (
                <SubEventCard key={sub.id} sub={sub} onClick={() => { setSelectedSub(sub); loadDelayLogs(selectedEvent.id) }} onDelete={handleDeleteSubEvent} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── SCREEN: DASHBOARD ─────────────────────────────────────────
  return (
    <div style={{ background: "#f8f7f4", minHeight: "100vh", padding: 32 }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img
              src="https://kanahevents.co/wp-content/uploads/2024/09/Kanah-Events-logo-e1726260992366.png"
              alt="Kanah Events"
              style={{ height: 52, objectFit: "contain" }}
              onError={e => { e.target.style.display = "none" }}
            />
            <div>
              <h1 style={{ color: "#7c3aed", fontFamily: "Georgia", fontSize: 26, margin: "0 0 2px", fontWeight: 700 }}>EventFlow</h1>
              <p style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 12, margin: 0, letterSpacing: 1 }}>KANAH EVENTS CO.</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LiveClock />
            <button onClick={() => setScreen("create")} style={{ background: "#7c3aed", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, padding: "9px 18px", cursor: "pointer", fontFamily: "Georgia" }}>+ New Event</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Total Events", value: events.length, color: "#4b5563" },
            { label: "Live", value: events.filter(e => e.status === "Live").length, color: "#34d399" },
            { label: "Drafting", value: events.filter(e => e.status === "Drafting").length, color: "#fbbf24" },
            { label: "Completed", value: events.filter(e => e.status === "Completed").length, color: "#94a3b8" },
          ].map(stat => (
            <div key={stat.label} style={{ flex: 1, background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ color: stat.color, fontFamily: "Georgia", fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
              <div style={{ color: "#6b7280", fontFamily: "Georgia", fontSize: 11, letterSpacing: 1 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280", fontFamily: "Georgia", fontSize: 14 }}>Loading events...</div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280", fontFamily: "Georgia", fontSize: 14 }}>No events yet. Click + New Event to get started.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {events.map(event => (
              <EventCard key={event.id} event={event} onStatusChange={handleStatusChange} onClick={() => { setSelectedEvent(event); loadEventVendors(event.id); loadDelayLogs(event.id) }} onDelete={handleDeleteEvent} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}