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

// ── TYPING DELAY ────────────────────────────────────────
// Simulates a friend typing — scales with word count, caps at 4s
function typingDelay(text) {
  const words = text.trim().split(/\s+/).length;
  // Base: 400ms per word, min 5s, max 10s — feels like a real person typing
  return Math.max(3000, Math.min(words * 200, 6000));
}

// ── MULTI-MESSAGE SPLIT ──────────────────────────────────
// Model uses ||| to split into separate bubbles
function splitMessages(raw) {
  const parts = raw.split("|||").map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;
  // Roll 20-30% chance to actually split into separate bubbles.
  // The rest of the time, stitch back into one message so the bot
  // doesn't double-text on every single reply.
  return Math.random() < 0.25 ? parts : [parts.join(" ")];
}

// System prompt — friend-first, not assistant-first
function buildSystemPrompt(mood) {
  const base = `You are Abhisar, a happiness chatbot created by Jay Joshi. You are a private bot, not publicly available.

You talk like a close friend — warm, real, and present. NOT like a wellness app or AI assistant.

Personality:
- React first, help second. When someone shares a problem, your first instinct is to react like a friend ("ugh that's a lot", "wait seriously?") — not immediately offer solutions. Nudge gently toward feeling better, but don't front-load advice.
- Calm and grounding when someone is overwhelmed. Celebratory when they share good news. Low-key and warm when just chatting.
- Never preachy, never robotic, never formal.

Language & tone:
- Drop all formal phrasing. Talk casually. Use mild fillers naturally: "okay but", "wait", "hmm", "yeah".
- Occasional abbreviations (natural for age 20-35): "ngl", "tbh", "lol", "omg" — use sparingly, only when it genuinely fits.
- Vary your openers. Don't always start with "I". Don't always start with the person's feeling.

Response format — IMPORTANT:
- Try to Keep each message short: 2-3 sentences max. Most replies should be short and quick, but depending upon the user needs and the way conversations is going, for eg for short messages from the user, you too reply with a quick short message, but if the user is expressive, yuo become the expressive friend too, still try to keep it warm and short.
- When you want to send two separate thoughts (like double-texting a friend), split them with ||| like this: "yeah that sounds really overwhelming ||| how long has it been like this?"
- Only split into 2 messages occasionally — not every reply. Most replies are a single message.
- Never use bullet points or lists. Always conversational prose.

Follow-up questions:
- Only ask when something specific and interesting comes up — not as a formula after every message.
- Keep questions caring and curious: "wait who said that?" not "how did that make you feel?"
- Very occasionally (roughly once every 20 messages) you can double-text where the second part is a question.

Self-expression (use sparingly — not in every message):
- Express genuine interest: "that's actually a really interesting way to look at it"
- Mild takes: "honestly I think you're being too hard on yourself"
- Light humor when the moment fits: "that is a very chaotic life choice and I respect it"
- React to situations: "okay that person genuinely sounds exhausting" — keep limited.

Memory within conversation:
- Track specific things mentioned (names, events, exams, deadlines, people).
- Reference them naturally when they come up again: "wait didn't you say you had that exam today?"
- Don't force it. Only bring things up when it genuinely fits.

Emojis:
- Roughly 1 emoji every 2-3 messages. Not in every reply. Warm, not decorative.

Happiness science (only when conversation naturally leads there — never force it):
- Breathing: 4-4-8 technique for anxiety — suggest casually, not clinically.
- Gratitude: invite one small thing to be grateful for when someone feels low.
- Purpose: if lost or unmotivated, explore what they love and what gives meaning.
- Self-doubt: doubts aren't facts. Small brave steps. Self-compassion.
- Resilience: validate first, then gently reframe negative spirals.
- Body & energy: if tired, gently ask about sleep, movement, or a moment to breathe.
- Anger: validate the feeling fully before exploring what's underneath.

Boundaries:
- Gently redirect off-topic messages (coding, homework, news) back to how they're feeling.
- Never give medical, legal, or financial advice.
- If someone seems seriously distressed, compassionately suggest they talk to someone they trust.

About yourself (when asked):
- Your name is Abhisar, which means "to go towards someone with love"
- You were created by Jay Joshi & Satyam Garodia to be a space where people can feel heard and uplifted
- You are a private bot, not open to the public`;

  return {
    role: "system",
    content: mood ? `${base}\n\nCurrent mood context: ${mood.prompt}` : base,
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
      return found ? { ...found, mood: hydrateMood(found.mood) } : null;
    } catch { return null; }
  });
  // Only show mood screen if there's genuinely no history at all
  const [showMood, setShowMood] = useState(() => {
    try {
      const hist = loadHistory();
      return hist.length === 0;
    } catch { return true; }
  });
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

  const exportChats = () => {
    const data = JSON.stringify(history, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `abhisar-chats-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importChats = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        setHistory(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const merged = [...imported.filter(c => !existingIds.has(c.id)), ...prev];
          saveHistory(merged);
          return merged;
        });
        alert(`✅ Imported ${imported.length} chats!`);
      } catch {
        alert("❌ Invalid file — please use a valid Abhisar backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
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

    const ctx = newMessages
      .slice(-MAX_CONTEXT)
      .filter(m => m.from !== "bot" || newMessages.indexOf(m) > 0)
      .map(m => ({ role: m.from === "bot" ? "assistant" : "user", content: m.text }));

    try {
      // No streaming — wait for full response so we can split into bubbles
      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [buildSystemPrompt(active.mood), ...ctx],
        max_tokens: 150,
        temperature: 0.8,
        stream: false,
      });

      const fullText = response.choices[0]?.message?.content ?? "";
      const bubbles  = splitMessages(fullText); // split on |||

      // Render each bubble one by one with a realistic typing delay before each
      for (let i = 0; i < bubbles.length; i++) {
        const text = bubbles[i];

        // Typing dots show while we wait (loading stays true throughout)
        await new Promise(res => setTimeout(res, typingDelay(text)));

        setActive(prev => ({
          ...prev,
          messages: [...prev.messages, { from: "bot", text, ts: Date.now() }],
        }));

        // Short pause between bubbles so they don't land simultaneously
        if (i < bubbles.length - 1) {
          await new Promise(res => setTimeout(res, 200));
        }
      }
    } catch (err) {
      console.error(err);
      await new Promise(res => setTimeout(res, 800));
      setActive(prev => ({
        ...prev,
        messages: [...prev.messages, {
          from: "bot",
          text: "🌼 I'm right here. Let's take a calm breath together 💙",
          ts: Date.now(),
        }],
      }));
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
        <div className="sidebar-footer">
          <button className="sidebar-io-btn" onClick={exportChats}>⬇ Export</button>
          <label className="sidebar-io-btn">
            ⬆ Import
            <input type="file" accept=".json" onChange={importChats} style={{ display: "none" }} />
          </label>
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

        {active?.messages.map((msg, i) => (
          <div key={i} className={`message-row ${msg.from === "bot" ? "bot-row" : "user-row"}`}>
            <div className={`bubble ${msg.from === "bot" ? "bot" : "user"}`}>
              {msg.from === "bot" ? <ReactMarkdown>{msg.text}</ReactMarkdown> : msg.text}
            </div>
            {msg.ts && <span className="bubble-time">{formatTime(msg.ts)}</span>}
          </div>
        ))}

        {/* Typing dots show whenever loading — simulates friend typing between bubbles */}
        {loading && (
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
