import { useState, useEffect } from "react"
import { supabase } from "./supabase"

const STATUS_OPTIONS = [
  { label: "Drafting",  color: "#fbbf24" },
  { label: "Reviewing", color: "#60a5fa" },
  { label: "Revisions", color: "#f87171" },
  { label: "Approved",  color: "#34d399" },
  { label: "Published", color: "#c084fc" },
  { label: "Live",      color: "#34d399" },
  { label: "Completed", color: "#94a3b8" },
  { label: "Archived",  color: "#334155" },
]

const PHASE_COLORS = [
  { label: "Purple", value: "#c084fc" },
  { label: "Blue",   value: "#60a5fa" },
  { label: "Green",  value: "#34d399" },
  { label: "Amber",  value: "#fbbf24" },
  { label: "Pink",   value: "#f472b6" },
  { label: "Orange", value: "#fb923c" },
]

function StatusTag({ status, onChange }) {
  const [open, setOpen] = useState(false)
  const current = STATUS_OPTIONS.find(s => s.label === status)
  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        style={{
          background: `${current?.color}18`,
          border: `1px solid ${current?.color}50`,
          borderRadius: 20, padding: "3px 10px",
          display: "inline-flex", alignItems: "center",
          gap: 5, cursor: "pointer"
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: current?.color }} />
        <span style={{ color: current?.color, fontSize: 10, fontFamily: "Georgia", letterSpacing: 2 }}>{status}</span>
        <span style={{ color: current?.color, fontSize: 9 }}>▼</span>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: 30, left: 0,
          background: "#0a0f18", border: "1px solid #1e2d40",
          borderRadius: 10, padding: 8, zIndex: 100,
          minWidth: 150, boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
        }}>
          {STATUS_OPTIONS.map(option => (
            <div
              key={option.label}
              onClick={(e) => { e.stopPropagation(); onChange(option.label); setOpen(false) }}
              style={{ padding: "7px 10px", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = `${option.color}12`}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: option.color }} />
              <span style={{ color: option.color, fontSize: 12, fontFamily: "Georgia" }}>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({ event, onStatusChange, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#0a0f18", border: "1px solid #1e2d40",
        borderRadius: 12, padding: 20, cursor: "pointer", transition: "border-color 0.2s"
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#c084fc40"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2d40"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h3 style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 16, margin: "0 0 4px" }}>{event.event_name}</h3>
          <p style={{ color: "#c084fc", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{event.client_name}</p>
        </div>
        <StatusTag status={event.status} onChange={(newStatus) => onStatusChange(event.id, newStatus)} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{event.event_date} · {event.venue}</p>
        {event.hashtag && <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{event.hashtag}</p>}
      </div>
    </div>
  )
}

function SubEventCard({ sub, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#0a0f18", border: `1px solid ${sub.color}30`,
        borderRadius: 10, padding: "16px 20px",
        display: "flex", justifyContent: "space-between",
        alignItems: "center", cursor: "pointer", transition: "border-color 0.2s"
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = `${sub.color}60`}
      onMouseLeave={e => e.currentTarget.style.borderColor = `${sub.color}30`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 3, height: 40, borderRadius: 2, background: sub.color, flexShrink: 0 }} />
        <div>
          <p style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 15, margin: "0 0 3px", fontWeight: 600 }}>{sub.label}</p>
          <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{sub.venue} · Starts {sub.startTime}</p>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ background: `${sub.color}18`, border: `1px solid ${sub.color}40`, borderRadius: 20, padding: "3px 12px", marginBottom: 4 }}>
          <span style={{ color: sub.color, fontSize: 11, fontFamily: "Georgia", letterSpacing: 1 }}>{sub.startTime}</span>
        </div>
        <p style={{ color: "#334155", fontSize: 11, fontFamily: "Georgia", margin: 0 }}>{(sub.items || []).length} items</p>
      </div>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState("dashboard")
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [selectedSub, setSelectedSub] = useState(null)
  const [showSubEventForm, setShowSubEventForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  // Create event form
  const [eventName, setEventName] = useState("")
  const [clientName, setClientName] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [venue, setVenue] = useState("")
  const [hashtag, setHashtag] = useState("")

  // Create sub-event form
  const [subLabel, setSubLabel] = useState("")
  const [subVenue, setSubVenue] = useState("")
  const [subStartTime, setSubStartTime] = useState("")
  const [subColor, setSubColor] = useState("#c084fc")

  // Create item form
  const [itemTime, setItemTime] = useState("")
  const [itemLabel, setItemLabel] = useState("")
  const [itemInvolved, setItemInvolved] = useState("")
  const [itemNotes, setItemNotes] = useState("")

  // ── LOAD EVENTS FROM SUPABASE ON STARTUP ──
  useEffect(() => {
    loadEvents()
  }, [])

  const loadEvents = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true })
    if (error) {
      console.error("Error loading events:", error)
    } else {
      setEvents(data || [])
    }
    setLoading(false)
  }

  // ── CREATE EVENT ──
  const handleCreate = async () => {
    if (!eventName || !clientName || !eventDate) return
    const newEvent = {
      event_name: eventName,
      client_name: clientName,
      event_date: eventDate,
      venue, hashtag,
      status: "Drafting",
      sub_events: []
    }
    const { data, error } = await supabase
      .from("events")
      .insert(newEvent)
      .select()
    if (error) {
      console.error("Error creating event:", error)
    } else {
      setEvents(prev => [...prev, data[0]].sort((a, b) =>
        new Date(a.event_date) - new Date(b.event_date)
      ))
      setEventName(""); setClientName(""); setEventDate("")
      setVenue(""); setHashtag("")
      setScreen("dashboard")
    }
  }

  // ── UPDATE STATUS ──
  const handleStatusChange = async (id, newStatus) => {
    await supabase.from("events").update({ status: newStatus }).eq("id", id)
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e))
  }

  // ── ADD SUB-EVENT ──
  const handleAddSubEvent = async () => {
    if (!subLabel || !subStartTime) return
    const newSub = {
      id: Date.now(),
      label: subLabel,
      venue: subVenue,
      startTime: subStartTime,
      color: subColor,
      items: []
    }
    const updatedSubEvents = [...(selectedEvent.sub_events || []), newSub]
    const { error } = await supabase
      .from("events")
      .update({ sub_events: updatedSubEvents })
      .eq("id", selectedEvent.id)
    if (!error) {
      setEvents(prev => prev.map(e =>
        e.id === selectedEvent.id ? { ...e, sub_events: updatedSubEvents } : e
      ))
      setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
    }
    setSubLabel(""); setSubVenue(""); setSubStartTime(""); setSubColor("#c084fc")
    setShowSubEventForm(false)
  }

  // ── ADD TIMELINE ITEM ──
  const handleAddItem = async () => {
    if (!itemTime || !itemLabel) return
    const newItem = {
      id: Date.now(),
      time: itemTime,
      label: itemLabel,
      involved: itemInvolved.split(",").map(s => s.trim()).filter(Boolean),
      notes: itemNotes
    }
    const updatedSubEvents = (selectedEvent.sub_events || []).map(s =>
      s.id === selectedSub.id ? { ...s, items: [...(s.items || []), newItem] } : s
    )
    const { error } = await supabase
      .from("events")
      .update({ sub_events: updatedSubEvents })
      .eq("id", selectedEvent.id)
    if (!error) {
      setEvents(prev => prev.map(e =>
        e.id === selectedEvent.id ? { ...e, sub_events: updatedSubEvents } : e
      ))
      setSelectedEvent(prev => ({ ...prev, sub_events: updatedSubEvents }))
      setSelectedSub(prev => ({ ...prev, items: [...(prev.items || []), newItem] }))
    }
    setItemTime(""); setItemLabel(""); setItemInvolved(""); setItemNotes("")
    setShowItemForm(false)
  }

  // ── SCREEN: CREATE EVENT ──
  if (screen === "create") {
    return (
      <div style={{ background: "#05080e", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 480, background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 16, padding: 32 }}>
          <div style={{ marginBottom: 32 }}>
            <button onClick={() => setScreen("dashboard")} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0, marginBottom: 16 }}>← Back</button>
            <h1 style={{ color: "#c084fc", fontFamily: "Georgia", fontSize: 28, margin: "0 0 6px" }}>New Event</h1>
            <p style={{ color: "#334155", fontSize: 13, margin: 0, fontFamily: "Georgia" }}>Fill in the details to get started</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[
              { label: "EVENT NAME *", value: eventName, setter: setEventName, placeholder: "e.g. The Josephs Wedding" },
              { label: "CLIENT NAME *", value: clientName, setter: setClientName, placeholder: "e.g. Deborah & Nifemi" },
              { label: "VENUE", value: venue, setter: setVenue, placeholder: "e.g. Trinity Event Center, Houston TX" },
              { label: "HASHTAG", value: hashtag, setter: setHashtag, placeholder: "e.g. #ForeverJoseph" },
            ].map(field => (
              <div key={field.label}>
                <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>{field.label}</label>
                <input value={field.value} onChange={(e) => field.setter(e.target.value)} placeholder={field.placeholder}
                  style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
              </div>
            ))}
            <div>
              <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>EVENT DATE *</label>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)}
                style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleCreate} style={{
              marginTop: 8, width: "100%", padding: "13px",
              background: eventName && clientName && eventDate ? "#c084fc" : "#1e2d40",
              border: "none", borderRadius: 8,
              color: eventName && clientName && eventDate ? "#05080e" : "#334155",
              fontSize: 15, fontWeight: 700,
              cursor: eventName && clientName && eventDate ? "pointer" : "default",
              fontFamily: "Georgia", transition: "all 0.2s"
            }}>Create Event →</button>
          </div>
        </div>
      </div>
    )
  }

  // ── SCREEN: TIMELINE VIEW ──
  if (selectedSub && selectedEvent) {
    return (
      <div style={{ background: "#05080e", minHeight: "100vh", padding: 32 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
            <button onClick={() => setSelectedSub(null)} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0 }}>← {selectedEvent.event_name}</button>
            <span style={{ color: "#1e2d40", fontSize: 13 }}>/</span>
            <span style={{ color: selectedSub.color, fontFamily: "Georgia", fontSize: 13 }}>{selectedSub.label}</span>
          </div>

          <div style={{ background: "#0a0f18", borderLeft: `4px solid ${selectedSub.color}`, border: `1px solid ${selectedSub.color}30`, borderRadius: 12, padding: 24, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h1 style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 24, margin: "0 0 6px" }}>{selectedSub.label}</h1>
                <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{selectedSub.venue} · Starts {selectedSub.startTime}</p>
              </div>
              <div style={{ background: `${selectedSub.color}18`, border: `1px solid ${selectedSub.color}40`, borderRadius: 20, padding: "4px 14px" }}>
                <span style={{ color: selectedSub.color, fontSize: 12, fontFamily: "Georgia", letterSpacing: 1 }}>{selectedSub.startTime}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 18, margin: 0 }}>Timeline</h2>
            <button onClick={() => setShowItemForm(!showItemForm)} style={{
              background: showItemForm ? "#1e2d40" : selectedSub.color, border: "none", borderRadius: 8,
              color: showItemForm ? "#475569" : "#05080e", fontSize: 12, fontWeight: 700,
              padding: "7px 14px", cursor: "pointer", fontFamily: "Georgia"
            }}>{showItemForm ? "Cancel" : "+ Add Item"}</button>
          </div>

          {showItemForm && (
            <div style={{ background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <p style={{ color: "#475569", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 16px" }}>NEW TIMELINE ITEM</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>TIME *</label>
                    <input value={itemTime} onChange={e => setItemTime(e.target.value)} placeholder="e.g. 9:00 AM"
                      style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>ACTIVITY *</label>
                    <input value={itemLabel} onChange={e => setItemLabel(e.target.value)} placeholder="e.g. Guest Arrival & Seating"
                      style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div>
                  <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>PARTIES INVOLVED</label>
                  <input value={itemInvolved} onChange={e => setItemInvolved(e.target.value)} placeholder="e.g. Coordinator, DJ, MC (comma separated)"
                    style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>NOTES</label>
                  <textarea value={itemNotes} onChange={e => setItemNotes(e.target.value)} placeholder="Any instructions, cues, or details..."
                    style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box", resize: "vertical", minHeight: 72 }} />
                </div>
                <button onClick={handleAddItem} style={{
                  width: "100%", padding: "11px",
                  background: itemTime && itemLabel ? selectedSub.color : "#1e2d40",
                  border: "none", borderRadius: 8,
                  color: itemTime && itemLabel ? "#05080e" : "#334155",
                  fontSize: 13, fontWeight: 700,
                  cursor: itemTime && itemLabel ? "pointer" : "default",
                  fontFamily: "Georgia", transition: "all 0.2s"
                }}>Add to Timeline →</button>
              </div>
            </div>
          )}

          {(!selectedSub.items || selectedSub.items.length === 0) ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#334155", fontFamily: "Georgia", fontSize: 14, background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 12 }}>
              No timeline items yet.<br />
              <span style={{ color: "#1e2d40", fontSize: 12 }}>Add your first item — Guest Arrival, Ceremony Begins, etc.</span>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 88, top: 0, bottom: 0, width: 1, background: "#1e2d40" }} />
              {selectedSub.items.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "flex-start", marginBottom: 16 }}>
                  <div style={{ width: 80, flexShrink: 0, paddingTop: 4, textAlign: "right" }}>
                    <span style={{ color: "#475569", fontFamily: "Georgia", fontSize: 12 }}>{item.time}</span>
                  </div>
                  <div style={{ width: 16, margin: "0 10px", display: "flex", justifyContent: "center", paddingTop: 8, flexShrink: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: selectedSub.color, border: `2px solid ${selectedSub.color}`, position: "relative", zIndex: 2 }} />
                  </div>
                  <div style={{ flex: 1, background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 8, padding: "10px 14px" }}>
                    <p style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 14, margin: "0 0 6px", fontWeight: 600 }}>{item.label}</p>
                    {item.involved && item.involved.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {item.involved.map(party => (
                          <span key={party} style={{ background: `${selectedSub.color}15`, border: `1px solid ${selectedSub.color}30`, borderRadius: 4, padding: "2px 8px", color: selectedSub.color, fontSize: 10, fontFamily: "Georgia" }}>{party}</span>
                        ))}
                      </div>
                    )}
                    {item.notes && <p style={{ color: "#475569", fontFamily: "Georgia", fontSize: 12, margin: 0, lineHeight: 1.6 }}>{item.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── SCREEN: EVENT DETAIL ──
  if (selectedEvent) {
    return (
      <div style={{ background: "#05080e", minHeight: "100vh", padding: 32 }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <button onClick={() => { setSelectedEvent(null); setShowSubEventForm(false) }}
            style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontFamily: "Georgia", fontSize: 13, padding: 0, marginBottom: 24 }}>← All Events</button>

          <div style={{ background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h1 style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 26, margin: "0 0 4px" }}>{selectedEvent.event_name}</h1>
                <p style={{ color: "#c084fc", fontFamily: "Georgia", fontSize: 15, margin: "0 0 4px" }}>{selectedEvent.client_name}</p>
                <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{selectedEvent.event_date} · {selectedEvent.venue}</p>
              </div>
              <StatusTag status={selectedEvent.status} onChange={(newStatus) => { handleStatusChange(selectedEvent.id, newStatus); setSelectedEvent(prev => ({ ...prev, status: newStatus })) }} />
            </div>
            {selectedEvent.hashtag && <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>{selectedEvent.hashtag}</p>}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 18, margin: 0 }}>Sub-Events</h2>
            <button onClick={() => setShowSubEventForm(!showSubEventForm)} style={{
              background: showSubEventForm ? "#1e2d40" : "#c084fc", border: "none", borderRadius: 8,
              color: showSubEventForm ? "#475569" : "#05080e", fontSize: 12, fontWeight: 700,
              padding: "7px 14px", cursor: "pointer", fontFamily: "Georgia"
            }}>{showSubEventForm ? "Cancel" : "+ Add Sub-Event"}</button>
          </div>

          {showSubEventForm && (
            <div style={{ background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <p style={{ color: "#475569", fontSize: 11, letterSpacing: 2, fontFamily: "Georgia", margin: "0 0 16px" }}>NEW SUB-EVENT</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "NAME *", value: subLabel, setter: setSubLabel, placeholder: "e.g. Traditional Wedding" },
                  { label: "VENUE", value: subVenue, setter: setSubVenue, placeholder: "e.g. Trinity Event Center" },
                  { label: "START TIME *", value: subStartTime, setter: setSubStartTime, placeholder: "e.g. 9:00 AM" },
                ].map(field => (
                  <div key={field.label}>
                    <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6, fontFamily: "Georgia" }}>{field.label}</label>
                    <input value={field.value} onChange={e => field.setter(e.target.value)} placeholder={field.placeholder}
                      style={{ width: "100%", background: "#05080e", border: "1px solid #1e2d40", borderRadius: 8, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", outline: "none", fontFamily: "Georgia", boxSizing: "border-box" }} />
                  </div>
                ))}
                <div>
                  <label style={{ color: "#475569", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 8, fontFamily: "Georgia" }}>COLOR</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {PHASE_COLORS.map(c => (
                      <div key={c.value} onClick={() => setSubColor(c.value)} style={{ width: 28, height: 28, borderRadius: "50%", background: c.value, cursor: "pointer", border: subColor === c.value ? "3px solid white" : "3px solid transparent", boxSizing: "border-box" }} />
                    ))}
                  </div>
                </div>
                <div style={{ background: `${subColor}10`, border: `1px solid ${subColor}30`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 3, height: 32, borderRadius: 2, background: subColor }} />
                  <div>
                    <p style={{ color: "#e2e8f0", fontFamily: "Georgia", fontSize: 14, margin: "0 0 2px" }}>{subLabel || "Sub-event name"}</p>
                    <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 12, margin: 0 }}>{subVenue || "Venue"} · {subStartTime || "Start time"}</p>
                  </div>
                </div>
                <button onClick={handleAddSubEvent} style={{
                  width: "100%", padding: "11px",
                  background: subLabel && subStartTime ? subColor : "#1e2d40", border: "none", borderRadius: 8,
                  color: subLabel && subStartTime ? "#05080e" : "#334155", fontSize: 13, fontWeight: 700,
                  cursor: subLabel && subStartTime ? "pointer" : "default", fontFamily: "Georgia", transition: "all 0.2s"
                }}>Add Sub-Event →</button>
              </div>
            </div>
          )}

          {(!selectedEvent.sub_events || selectedEvent.sub_events.length === 0) ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#334155", fontFamily: "Georgia", fontSize: 14, background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 12 }}>
              No sub-events yet. Add your first one —<br />Traditional Wedding, Church Ceremony, Reception...
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedEvent.sub_events.map(sub => (
                <SubEventCard key={sub.id} sub={sub} onClick={() => setSelectedSub(sub)} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── SCREEN: DASHBOARD ──
  return (
    <div style={{ background: "#05080e", minHeight: "100vh", padding: 32 }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <h1 style={{ color: "#c084fc", fontFamily: "Georgia", fontSize: 28, margin: "0 0 4px" }}>EventFlow</h1>
            <p style={{ color: "#334155", fontFamily: "Georgia", fontSize: 13, margin: 0 }}>Kanah Events Co.</p>
          </div>
          <button onClick={() => setScreen("create")} style={{ background: "#c084fc", border: "none", borderRadius: 8, color: "#05080e", fontSize: 13, fontWeight: 700, padding: "9px 18px", cursor: "pointer", fontFamily: "Georgia" }}>+ New Event</button>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Total Events", value: events.length, color: "#475569" },
            { label: "Live", value: events.filter(e => e.status === "Live").length, color: "#34d399" },
            { label: "Drafting", value: events.filter(e => e.status === "Drafting").length, color: "#fbbf24" },
            { label: "Completed", value: events.filter(e => e.status === "Completed").length, color: "#94a3b8" },
          ].map(stat => (
            <div key={stat.label} style={{ flex: 1, background: "#0a0f18", border: "1px solid #1e2d40", borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ color: stat.color, fontFamily: "Georgia", fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
              <div style={{ color: "#334155", fontFamily: "Georgia", fontSize: 11, letterSpacing: 1 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#334155", fontFamily: "Georgia", fontSize: 14 }}>
            Loading events...
          </div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#334155", fontFamily: "Georgia", fontSize: 14 }}>
            No events yet. Click + New Event to get started.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {events.map(event => (
              <EventCard key={event.id} event={event} onStatusChange={handleStatusChange} onClick={() => setSelectedEvent(event)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}