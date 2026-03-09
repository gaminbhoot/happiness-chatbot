import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Groq from "groq-sdk";
import ReactMarkdown from "react-markdown";
import "./chat.css";

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true,
});

const ACTIVE_KEY   = "abhisar_active";
const HISTORY_KEY  = "abhisar_history";

// ── OPTIMISATION CONSTANTS ──────────────────────────────
const MAX_CONTEXT     = 10;  // only last 10 messages sent to Groq (was 20)
const MAX_CONVOS      = 30;  // cap stored conversations
const MAX_MSG_STORED  = 50;  // cap messages stored per convo

const MOODS = [
  { emoji: "😄", label: "Happy",    color: "#fff3c4", prompt: "User is happy. Be fun and celebratory." },
  { emoji: "😌", label: "Calm",     color: "#cce8f5", prompt: "User is calm. Be peaceful and grounding." },
  { emoji: "😔", label: "Sad",      color: "#ddd0f7", prompt: "User is sad. Be warm, gentle, and uplifting." },
  { emoji: "😤", label: "Stressed", color: "#fcd5c8", prompt: "User is stressed. Be calming and reassuring." },
  { emoji: "😴", label: "Tired",    color: "#d4e8c2", prompt: "User is tired. Be cozy and low-energy." },
  { emoji: "🤩", label: "Excited",  color: "#fde4c0", prompt: "User is excited. Match their energy!" },
];

// System prompt is short and mood context is brief — minimises token overhead
function buildSystemPrompt(mood) {
  const base = `You are Abhisar, a happiness chatbot by Satyam Garodia & Jay Joshi.
Be kind, cheerful, and emotionally supportive. Positivity-first. Short responses (1-2 sentences). Emojis sparingly. Private bot.
Gently redirect off-topic messages back to happiness and motivation.`;
  return {
    role: "system",
    content: mood ? `${base}\nMood: ${mood.prompt}` : base,
  };
}

// ── STORAGE HELPERS ─────────────────────────────────────
// Store messages as compact [from, text, ts] tuples — saves ~30% space vs objects
function packMessages(msgs) {
  return msgs.map(m => [m.from === "bot" ? "b" : "u", m.text, m.ts]);
}
function unpackMessages(packed) {
  return packed.map(([f, text, ts]) => ({ from: f === "b" ? "bot" : "user", text, ts }));
}

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    // Unpack messages on load
    return raw.map(c => ({ ...c, messages: unpackMessages(c.messages || []) }));
  } catch { return []; }
}

function saveHistory(hist) {
  // Pack messages + cap convos before saving
  const capped = hist.slice(0, MAX_CONVOS).map(c => ({
    ...c,
    // Only store last MAX_MSG_STORED messages per convo — older messages aren't useful
    messages: packMessages(c.messages.slice(-MAX_MSG_STORED)),
    // Drop mood.prompt from storage — it's derivable, no need to persist
    mood: c.mood ? { emoji: c.mood.emoji, label: c.mood.label, color: c.mood.color } : null,
  }));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(capped));
}

// Restore full mood object (with prompt) from stored slim mood
function hydrateMood(slimMood) {
  if (!slimMood) return null;
  return MOODS.find(m => m.label === slimMood.label) || null;
}

const WELCOME = (mood) => ({
  from: "bot",
  text: mood
    ? `${mood.emoji} Feeling **${mood.label}** today — I've got you! Tell me what's on your mind.`
    : "Heyyy 🌸 I'm Abhisar, your Happiness Buddy. How are you feeling today?",
  ts: Date.now(),
});

function newConvo(mood = null) {
  return { id: Date.now().toString(), title: "New chat", messages: [WELCOME(mood)], updatedAt: Date.now(), mood };
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  const diff = new Date().setHours(0,0,0,0) - new Date(ts).setHours(0,0,0,0);
  if (diff === 0)        return "Today";
  if (diff === 86400000) return "Yesterday";
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── MOOD SCREEN ─────────────────────────────────────────
function MoodScreen({ onSelect }) {
  const [selected, setSelected] = useState(null);
  const [animating, setAnimating] = useState(false);
  const choose = (mood) => {
    setSelected(mood);
    setAnimating(true);
    setTimeout(() => onSelect(mood), 600);
  };
  return (
    <div className={`mood-screen ${animating ? "mood-exit" : ""}`}>
      <div className="mood-cloud">☁️</div>
      <h1 className="mood-heading">Hey there 🌸</h1>
      <p className="mood-sub">How are you feeling right now?</p>
      <div className="mood-grid">
        {MOODS.map((m) => (
          <button
            key={m.label}
            className={`mood-card ${selected?.label === m.label ? "selected" : ""}`}
            style={{ "--mood-color": m.color }}
            onClick={() => choose(m)}
          >
            <span className="mood-emoji">{m.emoji}</span>
            <span className="mood-label">{m.label}</span>
          </button>
        ))}
      </div>
      <button className="mood-skip" onClick={() => choose(null)}>Skip for now</button>
    </div>
  );
}

// ── MAIN ────────────────────────────────────────────────
export default function HappinessChat() {
  const chatEndRef = useRef(null);
  const saveTimer  = useRef(null); // debounce localStorage writes

  const [history,     setHistory]     = useState(loadHistory);
  const [active,      setActive]      = useState(() => {
    try {
      const id   = localStorage.getItem(ACTIVE_KEY);
      const hist = loadHistory();
      const found = hist.find(c => c.id === id) || hist[0] || null;
      // Hydrate mood.prompt which isn't stored
      return found ? { ...found, mood: hydrateMood(found.mood) } : null;
    } catch { return null; }
  });
  const [showMood,    setShowMood]    = useState(() => !localStorage.getItem(ACTIVE_KEY));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);

  // Persist active id
  useEffect(() => {
    if (active) localStorage.setItem(ACTIVE_KEY, active.id);
  }, [active?.id]);

  // Debounced save — batches rapid message updates into one write
  useEffect(() => {
    if (!active) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setHistory(prev => {
        const exists  = prev.find(c => c.id === active.id);
        const updated = exists
          ? prev.map(c => c.id === active.id ? { ...active, updatedAt: Date.now() } : c)
          : [{ ...active, updatedAt: Date.now() }, ...prev];
        saveHistory(updated);
        return updated;
      });
    }, 500); // wait 500ms before writing — avoids writing mid-stream

    return () => clearTimeout(saveTimer.current);
  }, [active?.messages]);

  const handleMoodSelect = (mood) => {
    setActive(newConvo(mood));
    setShowMood(false);
  };

  const openConvo = (convo) => {
    setActive({ ...convo, mood: hydrateMood(convo.mood) });
    setSidebarOpen(false);
  };

  const newChat = useCallback(() => {
    setShowMood(true);
    setSidebarOpen(false);
  }, []);

  const deleteConvo = (e, id) => {
    e.stopPropagation();
    setHistory(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveHistory(updated);
      return updated;
    });
    if (active?.id === id) newChat();
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !active) return;

    const userText    = input.trim();
    const newMessages = [...active.messages, { from: "user", text: userText, ts: Date.now() }];
    const title       = active.title === "New chat"
      ? userText.slice(0, 36) + (userText.length > 36 ? "…" : "")
      : active.title;

    setActive(prev => ({ ...prev, messages: newMessages, title }));
    setInput("");
    setLoading(true);

    // Only send last MAX_CONTEXT messages, and strip timestamps — Groq doesn't need them
    const ctx = newMessages
      .slice(-MAX_CONTEXT)
      .filter(m => m.from !== "bot" || newMessages.indexOf(m) > 0) // skip welcome msg
      .map(m => ({ role: m.from === "bot" ? "assistant" : "user", content: m.text }));

    // Add an empty bot message immediately — we'll stream text into it
    const botMsg = { from: "bot", text: "", ts: Date.now() };
    setActive(prev => ({ ...prev, messages: [...prev.messages, botMsg] }));

    try {
      const stream = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [buildSystemPrompt(active.mood), ...ctx],
        max_tokens: 120,
        temperature: 0.8,
        stream: true,  // ← the only change needed on the API side
      });

      let fullText = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (!delta) continue;
        fullText += delta;
        // Update the last message in-place with accumulated text
        setActive(prev => {
          const msgs = [...prev.messages];
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: fullText };
          return { ...prev, messages: msgs };
        });
      }
    } catch (err) {
      console.error(err);
      setActive(prev => {
        const msgs = [...prev.messages];
        msgs[msgs.length - 1] = {
          ...msgs[msgs.length - 1],
          text: "🌼 I'm right here. Let's take a calm breath together 💙",
        };
        return { ...prev, messages: msgs };
      });
    }

    setLoading(false);
  };

  if (showMood) return <MoodScreen onSelect={handleMoodSelect} />;

  return (
    <div className="happy-container">
      <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <span className="sidebar-title">Chats</span>
          <button className="sidebar-new-btn" onClick={newChat}>＋ New</button>
        </div>
        <div className="sidebar-list">
          {history.length === 0 && <p className="sidebar-empty">No chats yet 💭</p>}
          {history.map(convo => (
            <div
              key={convo.id}
              className={`sidebar-item ${convo.id === active?.id ? "active" : ""}`}
              onClick={() => openConvo(convo)}
            >
              <div className="sidebar-item-inner">
                <div className="sidebar-item-top">
                  {convo.mood && <span className="sidebar-mood-badge">{convo.mood.emoji}</span>}
                  <span className="sidebar-item-title">{convo.title}</span>
                </div>
                <span className="sidebar-item-date">{formatDate(convo.updatedAt)}</span>
              </div>
              <button className="sidebar-delete-btn" onClick={(e) => deleteConvo(e, convo.id)}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      <div className="happy-header">
        <button className="menu-btn" onClick={() => setSidebarOpen(o => !o)}>
          <span /><span /><span />
        </button>
        <div className="header-content">
          <div className="header-avatar">{active?.mood ? active.mood.emoji : "☁️"}</div>
          <div className="header-text">
            <span className="header-name">Abhisar</span>
            <span className="header-status">
              <span className="status-dot" />
              {active?.mood ? `feeling ${active.mood.label.toLowerCase()}` : "always here for you"}
            </span>
          </div>
        </div>
        <button className="clear-btn" onClick={newChat} title="New chat">↺</button>
      </div>

      <div className="chat-box">
        {active?.mood && (
          <div className="mood-banner" style={{ "--mood-color": active.mood.color }}>
            {active.mood.emoji} {active.mood.label} mode
          </div>
        )}
        <div className="date-divider">Today</div>

        {active?.messages.map((msg, i) => {
          const isStreaming = loading && i === active.messages.length - 1 && msg.from === "bot";
          return (
          <div key={i} className={`message-row ${msg.from === "bot" ? "bot-row" : "user-row"}`}>
            <div className={`bubble ${msg.from === "bot" ? "bot" : "user"}${isStreaming ? " streaming" : ""}`}>
              {msg.from === "bot" ? <ReactMarkdown>{msg.text}</ReactMarkdown> : msg.text}
            </div>
            {msg.ts && !isStreaming && <span className="bubble-time">{formatTime(msg.ts)}</span>}
          </div>
          );
        })}

        {loading && active?.messages[active.messages.length - 1]?.text === "" && (
          <div className="typing-bubble">
            <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="input-area">
        <input
          placeholder="Share what's on your mind… 💙"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
        />
        <button className="send-btn" onClick={sendMessage} disabled={loading}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
            <polygon points="2,2 22,12 2,22" fill="white" stroke="white" strokeWidth="1.5"/>
            <line x1="2" y1="12" x2="13" y2="12" stroke="var(--user-end)" strokeWidth="1.5"/>
          </svg>
        </button>
      </div>
    </div>
  );
}