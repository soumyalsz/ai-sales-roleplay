"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import rawPersonas from "@data/personas.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CallStatus = "idle" | "connecting" | "connected" | "speaking" | "error";

interface Persona {
  id: string;
  name: string;
  role: string;
  industry: string;
  difficulty: "Easy" | "Medium" | "Hard" | string;
  tone: string;
  avatarColor: string;
  avatar?: string;
  background: string;
  objectionStyle: string;
  keyObjections: string[];
  systemPromptInstructions: string;
}

interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

interface LiveMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  isFinal: boolean;
  timestamp: string;
}

interface Evaluation {
  tooShort: boolean;
  overallScore: number;
  discovery: { score: number; notes: string };
  objections: { score: number; notes: string };
  tone: { score: number; notes: string };
  highlightGood: string | null;
  highlightImprove: string | null;
  recommendations: string[];
}

// Order mapping to guarantee Easy -> Medium -> Hard sorting
const DIFFICULTY_ORDER: Record<string, number> = {
  Easy: 1,
  Medium: 2,
  Hard: 3,
};

// ---------------------------------------------------------------------------
// Transcript analysis engine
// ---------------------------------------------------------------------------

const QUESTION_PATTERNS = [
  /\bwhat\b.*\?/i, /\bhow\b.*\?/i, /\bwhy\b.*\?/i, /\bwhen\b.*\?/i,
  /\bwho\b.*\?/i, /\bwhich\b.*\?/i, /\bcan you\b.*\?/i, /\bcould you\b.*\?/i,
  /\btell me\b/i, /\bwalk me through\b/i, /\bwhat if\b/i,
];

const POSITIVE_TONE_MARKERS = [
  /\bi understand\b/i, /\bthat's a great\b/i, /\bthat makes sense\b/i,
  /\babsolutely\b/i, /\bgreat question\b/i, /\bgood point\b/i,
  /\bthank you\b/i, /\bappreciate\b/i, /\bhappy to\b/i,
  /\blet me explain\b/i, /\bhere's how\b/i, /\bfor example\b/i,
];

const NEGATIVE_TONE_MARKERS = [
  /\byou're wrong\b/i, /\bthat's not true\b/i, /\byou should\b/i,
  /\bobviously\b/i, /\bjust trust me\b/i, /\bjust buy\b/i,
];

function analyseTranscript(messages: TranscriptMessage[], persona: Persona): Evaluation {
  const userMsgs = messages.filter((m) => m.role === "user");
  const assistantMsgs = messages.filter((m) => m.role === "assistant");

  if (userMsgs.length < 2) {
    return {
      tooShort: true,
      overallScore: 0,
      discovery: { score: 0, notes: "" },
      objections: { score: 0, notes: "" },
      tone: { score: 0, notes: "" },
      highlightGood: null,
      highlightImprove: null,
      recommendations: [],
    };
  }

  // Discovery & Questioning
  const questionCount = userMsgs.reduce(
    (sum, m) => sum + QUESTION_PATTERNS.filter((p) => p.test(m.text)).length,
    0
  );
  const discoveryRatio = questionCount / Math.max(userMsgs.length, 1);
  const discoveryScore = Math.min(10, Math.round(discoveryRatio * 12 + (questionCount >= 2 ? 2 : 0)));
  const discoveryNotes =
    questionCount === 0
      ? "No discovery questions detected. Try asking about their specific goals and pain points."
      : questionCount <= 2
        ? `Asked ${questionCount} question(s). Good start, but probe deeper into the prospect's needs.`
        : `Strong discovery — asked ${questionCount} insightful questions to uncover requirements.`;

  // Objection Handling
  const surfacedObjections = persona.keyObjections.filter((obj) =>
    assistantMsgs.some((m) => {
      const normObj = obj.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
      return m.text.toLowerCase().includes(normObj) ||
        obj.toLowerCase().split(/\s+/).some((w) => w.length > 5 && m.text.toLowerCase().includes(w));
    })
  );

  let objectionResponses = 0;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "assistant" && messages[i + 1]?.role === "user") {
      const aText = messages[i].text.toLowerCase();
      const hasObjection = persona.keyObjections.some((obj) =>
        obj.toLowerCase().split(/\s+/).some((w) => w.length > 4 && aText.includes(w))
      );
      if (hasObjection && messages[i + 1].text.length > 20) {
        objectionResponses++;
      }
    }
  }

  const objectionScore = Math.min(
    10,
    Math.round(
      (surfacedObjections.length > 0 ? (objectionResponses / surfacedObjections.length) * 7 : 5) +
      (objectionResponses >= 2 ? 3 : objectionResponses >= 1 ? 1.5 : 0)
    )
  );
  const objectionNotes =
    surfacedObjections.length === 0
      ? "No major objections were raised during this conversation duration."
      : objectionResponses >= surfacedObjections.length
        ? `Effectively addressed ${objectionResponses} of ${surfacedObjections.length} objection(s) raised.`
        : `${surfacedObjections.length} objection(s) raised; ${objectionResponses} received a detailed answer.`;

  // Tone & Professionalism
  const posHits = userMsgs.reduce(
    (s, m) => s + POSITIVE_TONE_MARKERS.filter((p) => p.test(m.text)).length,
    0
  );
  const negHits = userMsgs.reduce(
    (s, m) => s + NEGATIVE_TONE_MARKERS.filter((p) => p.test(m.text)).length,
    0
  );
  const toneRaw = Math.min(10, Math.max(1, 5 + posHits * 1.5 - negHits * 3));
  const toneScore = Math.round(toneRaw);
  const toneNotes =
    negHits > 0
      ? `Avoided overly rigid responses (${negHits} pushy phrase detected). Reframe with consultative language.`
      : posHits >= 3
        ? "Exceptional collaborative tone. Maintained high professionalism throughout."
        : posHits >= 1
          ? "Balanced and professional demeanor. Use more active listening cues to deepen trust."
          : "Professional, neutral tone. Adding empathetic phrases can further build rapport.";

  // Highlights
  let highlightGood: string | null = null;
  let highlightImprove: string | null = null;
  let bestLen = 0;
  let shortestResponseLen = Infinity;

  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "assistant" && messages[i + 1]?.role === "user") {
      const reply = messages[i + 1].text;
      if (reply.length > bestLen) {
        bestLen = reply.length;
        highlightGood = reply;
      }
      if (reply.length < shortestResponseLen && reply.length > 5) {
        shortestResponseLen = reply.length;
        highlightImprove = reply;
      }
    }
  }

  if (highlightGood === highlightImprove) highlightImprove = null;

  const truncate = (s: string | null, max: number) =>
    s && s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
  highlightGood = truncate(highlightGood, 180);
  highlightImprove = truncate(highlightImprove, 180);

  const overallScore = Math.min(10, Math.max(1, Math.round((discoveryScore + objectionScore + toneScore) / 3)));

  const recommendations: string[] = [];
  if (questionCount < 3) {
    recommendations.push("Ask more open-ended discovery questions to uncover root motivations.");
  }
  if (objectionResponses < surfacedObjections.length) {
    recommendations.push("Acknowledge objections first before offering solutions or counter-arguments.");
  }
  if (posHits < 2) {
    recommendations.push('Incorporate rapport-building phrases like "I appreciate your concern" or "That\'s valid".');
  }
  if (recommendations.length < 3 && userMsgs.some((m) => m.text.length < 15)) {
    recommendations.push("Provide structured, complete responses rather than short single-sentence replies.");
  }
  if (recommendations.length < 3) {
    recommendations.push(`Tailor your pitch specifically to ${persona.name}'s role as ${persona.role}.`);
  }
  if (recommendations.length < 3) {
    recommendations.push("Conclude the conversation with a concrete next step or follow-up offer.");
  }

  return {
    tooShort: false,
    overallScore,
    discovery: { score: discoveryScore, notes: discoveryNotes },
    objections: { score: objectionScore, notes: objectionNotes },
    tone: { score: toneScore, notes: toneNotes },
    highlightGood,
    highlightImprove,
    recommendations: recommendations.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VoiceBot() {
  // Guarantee Easy -> Medium -> Hard sorting
  const personasList = useMemo(() => {
    return [...(rawPersonas as Persona[])].sort((a, b) => {
      const orderA = DIFFICULTY_ORDER[a.difficulty] ?? 99;
      const orderB = DIFFICULTY_ORDER[b.difficulty] ?? 99;
      return orderA - orderB;
    });
  }, []);

  const [selectedPersona, setSelectedPersona] = useState<Persona>(personasList[0]);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<LiveMessage[]>([]);
  const [vapiPublicKey, setVapiPublicKey] = useState<string>("");

  const vapiRef = useRef<Vapi | null>(null);
  const transcriptRef = useRef<TranscriptMessage[]>([]);
  const personaAtCallStart = useRef<Persona>(selectedPersona);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Vapi key from localStorage or fallback to env var
    const storedKey = localStorage.getItem("VAPI_PUBLIC_KEY");
    if (storedKey) {
      setVapiPublicKey(storedKey);
    } else if (process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY) {
      setVapiPublicKey(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY);
    }
  }, []);

  const saveKey = useCallback(() => {
    localStorage.setItem("VAPI_PUBLIC_KEY", vapiPublicKey);
  }, [vapiPublicKey]);

  const clearKey = useCallback(() => {
    localStorage.removeItem("VAPI_PUBLIC_KEY");
    setVapiPublicKey("");
  }, []);

  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      vapiRef.current.stop();
      vapiRef.current.removeAllListeners();
      vapiRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startCall = useCallback(async () => {
    if (!vapiPublicKey) {
      setCallStatus("error");
      setErrorMessage("Vapi Public Key is required to start a call.");
      return;
    }

    cleanup();

    setCallStatus("connecting");
    setErrorMessage(null);
    setEvaluation(null);
    setLiveTranscript([]);
    transcriptRef.current = [];
    personaAtCallStart.current = selectedPersona;

    const vapi = new Vapi(vapiPublicKey);
    vapiRef.current = vapi;

    vapi.on("call-start", () => setCallStatus("connected"));

    vapi.on("call-end", () => {
      const result = analyseTranscript(transcriptRef.current, personaAtCallStart.current);
      setEvaluation(result);
      setCallStatus("idle");
      setIsMuted(false);
      cleanup();
    });

    vapi.on("speech-start", () => setCallStatus("speaking"));
    vapi.on("speech-end", () => setCallStatus("connected"));

    vapi.on("error", (err) => {
      const message = typeof err === "string" ? err : (err as Error)?.message ?? "";
      // "Meeting has ended" is fired by Daily.co during normal call teardown — not a real error
      if (message.toLowerCase().includes("meeting has ended")) {
        console.info("[Vapi] Call teardown complete (Meeting has ended — expected).");
        return;
      }
      console.error("[Vapi Error]", err);
      setCallStatus("error");
      setErrorMessage(message || "An error occurred with the voice session.");
    });

    vapi.on("message", (msg: Record<string, unknown>) => {
      if (msg.type === "transcript") {
        console.log("[Vapi Transcript Event]", msg);
      }

      if (
        msg.type === "transcript" &&
        typeof msg.transcript === "string" &&
        (msg.role === "user" || msg.role === "assistant")
      ) {
        const isFinal = msg.transcriptType === "final";
        const role = msg.role as "user" | "assistant";
        const text = msg.transcript;
        const now = new Date();
        const timestamp = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        if (isFinal) {
          transcriptRef.current.push({ role, text });
        }

        setLiveTranscript((prev) => {
          // For partial messages, update the last entry if it's the same role and not final
          const last = prev[prev.length - 1];
          if (!isFinal && last && last.role === role && !last.isFinal) {
            return [...prev.slice(0, -1), { ...last, text }];
          }
          // For a new final message, mark the last partial as final and add
          if (isFinal && last && last.role === role && !last.isFinal) {
            return [...prev.slice(0, -1), { ...last, text, isFinal: true }];
          }
          // New message entry
          return [...prev, { id: `${role}-${Date.now()}`, role, text, isFinal, timestamp }];
        });
      }
    });

    const systemPrompt = [
      selectedPersona.systemPromptInstructions,
      `\nYour name is ${selectedPersona.name}. Your role is ${selectedPersona.role} at a ${selectedPersona.industry}.`,
      `Your tone is: ${selectedPersona.tone}.`,
      `Key objections you should raise:\n${selectedPersona.keyObjections.map((o) => `- ${o}`).join("\n")}`,
    ].join("\n");

    try {
      await vapi.start({
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }],
        },
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: "en",
          endpointing: 300,
        },
        name: `${selectedPersona.name} – ${selectedPersona.role}`,
        firstMessage: `Hello, this is ${selectedPersona.name}.`,
      });
    } catch (err) {
      console.error("[Vapi Start Error]", err);
      setCallStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to start voice call.");
    }
  }, [selectedPersona, cleanup]);

  const endCall = useCallback(() => {
    if (vapiRef.current) {
      vapiRef.current.stop();
    } else {
      setCallStatus("idle");
      setIsMuted(false);
    }
  }, []);

  const resetEvaluation = useCallback(() => {
    setEvaluation(null);
    transcriptRef.current = [];
  }, []);

  const toggleMute = useCallback(() => {
    if (vapiRef.current) {
      const next = !isMuted;
      vapiRef.current.setMuted(next);
      setIsMuted(next);
    }
  }, [isMuted]);

  const isActive = callStatus === "connected" || callStatus === "speaking";

  // Auto-scroll transcript to bottom when new messages arrive
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [liveTranscript]);

  return (
    <div className="flex flex-col gap-10 w-full font-sans">

      {/* ── API Key Configuration ────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 shadow-lg">
        <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-3">
          Vapi Configuration
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="password"
            value={vapiPublicKey}
            onChange={(e) => {
              const val = e.target.value;
              setVapiPublicKey(val);
              if (!val) {
                localStorage.removeItem("VAPI_PUBLIC_KEY");
              }
            }}
            placeholder="Enter VAPI Public Key"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-colors font-mono"
            autoComplete="off"
          />
          <button
            onClick={saveKey}
            className="whitespace-nowrap px-6 py-2.5 bg-white text-black font-semibold text-sm rounded-lg hover:bg-zinc-200 transition-colors"
          >
            Save Key
          </button>
          <button
            onClick={clearKey}
            className="whitespace-nowrap px-6 py-2.5 bg-zinc-900 border border-zinc-700 text-zinc-300 font-semibold text-sm rounded-lg hover:bg-zinc-800 hover:text-white transition-colors"
          >
            Clear Key
          </button>
        </div>
        <p className="text-zinc-500 text-[11px] mt-2 font-mono">
          Saved to localStorage. Get your key from the Vapi Dashboard.
        </p>
      </section>

      {/* ── Persona Cards (Ordered Easy -> Medium -> Hard) ──────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-mono uppercase tracking-widest text-zinc-400">
            01 / Select Difficulty & Prospect
          </h2>
          <span className="text-xs text-zinc-500 font-mono">
            {personasList.length} Available
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {personasList.map((p) => {
            const active = p.id === selectedPersona.id;

            return (
              <button
                key={p.id}
                disabled={isActive || callStatus === "connecting"}
                onClick={() => { setSelectedPersona(p); setEvaluation(null); }}
                className={[
                  "group relative flex flex-col items-start gap-4 rounded-xl p-5 text-left transition-all duration-300",
                  "border",
                  active
                    ? "border-white bg-zinc-900/90 shadow-2xl shadow-white/5 ring-1 ring-white/20"
                    : "border-zinc-800/80 bg-zinc-950/60 hover:bg-zinc-900/50 hover:border-zinc-700",
                  (isActive || callStatus === "connecting") ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                {/* Header row: difficulty badge */}
                <div className="flex items-center justify-between w-full">
                  <span className={[
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-mono tracking-wide uppercase border",
                    p.difficulty === "Easy"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-medium"
                      : p.difficulty === "Medium"
                        ? "bg-amber-500/15 text-amber-400 border-amber-500/30 font-medium"
                        : "bg-rose-500/15 text-rose-400 border-rose-500/30 font-medium"
                  ].join(" ")}>
                    {p.difficulty}
                  </span>

                  {active && (
                    <span className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      Selected
                    </span>
                  )}
                </div>

                {/* Avatar + Name & Role */}
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden border border-zinc-700 bg-zinc-800">
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white font-bold text-lg">
                        {p.name[0]}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-base tracking-tight group-hover:text-white transition-colors">
                      {p.name}
                    </h3>
                    <p className="text-zinc-400 text-xs mt-0.5 font-light">
                      {p.role}
                    </p>
                  </div>
                </div>

                {/* Industry & Objection Style */}
                <div className="mt-auto pt-3 border-t border-zinc-900 w-full flex flex-col gap-1">
                  <p className="text-zinc-500 text-[11px] font-mono uppercase tracking-wider">
                    {p.industry}
                  </p>
                  <p className="text-zinc-400 text-xs italic font-light leading-snug">
                    &ldquo;{p.objectionStyle}&rdquo;
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Call Interface Panel ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-xl p-8 flex flex-col items-center gap-8 shadow-2xl relative overflow-hidden">
        {/* Subtle grid pattern background */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] opacity-[0.03] pointer-events-none" />

        <div className="flex items-center justify-between w-full text-xs font-mono text-zinc-500 uppercase tracking-widest relative z-10">
          <span>02 / Live Audio Session</span>
          <span className="text-zinc-400">{selectedPersona.name} &bull; {selectedPersona.difficulty}</span>
        </div>

        {/* Minimalist Visualizer Orb */}
        <div className="relative flex items-center justify-center w-36 h-36 my-2 relative z-10">
          {callStatus === "speaking" && (
            <>
              <span className="absolute inset-0 rounded-full border border-white/30 bg-white/5 animate-ping opacity-40" />
              <span className="absolute -inset-3 rounded-full border border-white/20 bg-white/5 animate-ping opacity-20" style={{ animationDelay: "200ms" }} />
            </>
          )}

          {callStatus === "connecting" && (
            <span className="absolute -inset-1 rounded-full border border-dashed border-zinc-400 animate-spin" />
          )}

          <div
            className={[
              "relative z-10 flex flex-col items-center justify-center w-28 h-28 rounded-full border overflow-hidden transition-all duration-500 shadow-2xl",
              callStatus === "speaking"
                ? "border-white scale-105 shadow-white/10"
                : callStatus === "connected"
                  ? "border-zinc-700"
                  : "border-zinc-800 bg-zinc-950",
            ].join(" ")}
          >
            {selectedPersona.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedPersona.avatar} alt={selectedPersona.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-semibold text-white tracking-tight">
                {selectedPersona.name[0]}
              </span>
            )}
          </div>
        </div>

        {/* Status Text */}
        <div className="text-center relative z-10 max-w-sm">
          <p className="text-white font-medium text-base tracking-tight">
            {selectedPersona.name} &mdash; {selectedPersona.role}
          </p>
          <p className="text-zinc-400 text-xs mt-1 font-mono">
            {callStatus === "idle" && !evaluation && "Click Start Call to initiate real-time audio."}
            {callStatus === "idle" && evaluation && "Session completed. Review your feedback below."}
            {callStatus === "connecting" && "Establishing WebRTC audio channel…"}
            {callStatus === "connected" && "Call active. Speak into your microphone."}
            {callStatus === "speaking" && `${selectedPersona.name} is responding…`}
            {callStatus === "error" && (errorMessage ?? "Call connection failed.")}
          </p>
        </div>

        {/* Call Controls */}
        <div className="flex items-center gap-4 relative z-10 pt-2">
          {(callStatus === "idle" || callStatus === "error") && !evaluation && (
            <button
              onClick={startCall}
              className="inline-flex items-center gap-2.5 rounded-full bg-white hover:bg-zinc-200 active:bg-zinc-300 text-black font-semibold text-xs uppercase tracking-wider px-8 py-3.5 transition-all shadow-xl shadow-white/10 cursor-pointer"
            >
              <PhoneIcon className="w-4 h-4" />
              Start Call
            </button>
          )}

          {isActive && (
            <button
              onClick={toggleMute}
              className={[
                "inline-flex items-center gap-2 rounded-full font-mono text-xs uppercase tracking-wider px-6 py-3.5 transition-all border cursor-pointer",
                isMuted
                  ? "bg-zinc-800 text-white border-zinc-600"
                  : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white",
              ].join(" ")}
            >
              {isMuted ? <MicOffIcon className="w-4 h-4 text-white" /> : <MicIcon className="w-4 h-4" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
          )}

          {(isActive || callStatus === "connecting") && (
            <button
              onClick={endCall}
              className="inline-flex items-center gap-2.5 rounded-full bg-zinc-950 border border-zinc-700 hover:border-red-500/60 hover:bg-red-950/20 text-red-400 font-semibold text-xs uppercase tracking-wider px-7 py-3.5 transition-all shadow-lg cursor-pointer"
            >
              <PhoneOffIcon className="w-4 h-4" />
              End Call
            </button>
          )}
        </div>

        {/* ── Live Transcript ─────────────────────────────────────────── */}
        {(isActive || callStatus === "connecting") && (
          <div className="w-full relative z-10 border-t border-zinc-800/60 pt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono uppercase tracking-widest text-zinc-500">
                Live Transcript
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {isActive ? "Live Listening" : "Connecting"}
              </span>
            </div>

            <div
              ref={transcriptScrollRef}
              className="h-56 overflow-y-auto flex flex-col gap-2.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
            >
              {liveTranscript.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-zinc-600 text-xs font-mono italic">Waiting for conversation to begin…</p>
                </div>
              ) : (
                liveTranscript.map((msg, idx) => (
                  <div
                    key={msg.id ?? idx}
                    className={[
                      "flex flex-col gap-1",
                      msg.role === "user" ? "items-end" : "items-start",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={[
                        "text-[10px] font-mono uppercase tracking-wider",
                        msg.role === "user" ? "text-indigo-400" : "text-emerald-500",
                      ].join(" ")}>
                        {msg.role === "user" ? "You" : selectedPersona.name}
                      </span>
                      {msg.timestamp && (
                        <span className="text-[9px] text-zinc-600 font-mono">{msg.timestamp}</span>
                      )}
                    </div>
                    <div
                      className={[
                        "max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed",
                        msg.isFinal ? "opacity-100" : "opacity-60 italic",
                        msg.role === "user"
                          ? "bg-indigo-500/15 border border-indigo-500/25 text-indigo-100 rounded-tr-none"
                          : "bg-zinc-800/70 border border-zinc-700/60 text-zinc-200 rounded-tl-none",
                      ].join(" ")}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Evaluation Card ──────────────────────────────────────────────── */}
      {evaluation && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl animate-[fadeSlideIn_0.4s_ease-out]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-mono uppercase tracking-widest text-zinc-400">
              03 / Performance Breakdown
            </h2>
            <span className="text-xs text-zinc-500 font-mono">
              Prospect: {personaAtCallStart.current.name} ({personaAtCallStart.current.difficulty})
            </span>
          </div>

          {evaluation.tooShort ? (
            <div className="flex flex-col items-center gap-4 text-center py-8">
              <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <ClockIcon className="w-5 h-5 text-zinc-400" />
              </div>
              <h3 className="text-white font-medium text-base">Session Too Short</h3>
              <p className="text-zinc-400 text-xs max-w-md font-light leading-relaxed">
                The call ended before sufficient conversation turns occurred. Speak a bit longer with the prospect to get a complete score.
              </p>
              <button
                onClick={resetEvaluation}
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white font-mono text-xs uppercase tracking-wider px-6 py-3 transition-colors cursor-pointer"
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                Practice Again
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {/* Overall Score Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-900">
                <div>
                  <h3 className="text-white font-semibold text-xl tracking-tight">Call Evaluation Summary</h3>
                  <p className="text-zinc-400 text-xs mt-1 font-light">
                    Automated transcript analysis against {personaAtCallStart.current.name}&apos;s persona profile.
                  </p>
                </div>
                <div className="flex items-center gap-3 self-start sm:self-auto bg-zinc-900/90 border border-zinc-800 rounded-xl px-5 py-3">
                  <div className="text-3xl font-bold font-mono text-white leading-none">
                    {evaluation.overallScore}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Score</span>
                    <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wide">
                      {evaluation.overallScore >= 8 ? "Superior" : evaluation.overallScore >= 5 ? "Competent" : "Needs Practice"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3 Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MetricCard title="Discovery & Questions" score={evaluation.discovery.score} notes={evaluation.discovery.notes} />
                <MetricCard title="Objection Resolution" score={evaluation.objections.score} notes={evaluation.objections.notes} />
                <MetricCard title="Consultative Tone" score={evaluation.tone.score} notes={evaluation.tone.notes} />
              </div>

              {/* Highlights */}
              {(evaluation.highlightGood || evaluation.highlightImprove) && (
                <div className="pt-2">
                  <h4 className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-4">
                    Transcript Moments
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {evaluation.highlightGood && (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-2">
                        <span className="text-white text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-white" />
                          Effective Pitch Response
                        </span>
                        <p className="text-zinc-300 text-xs italic font-light leading-relaxed">
                          &ldquo;{evaluation.highlightGood}&rdquo;
                        </p>
                      </div>
                    )}

                    {evaluation.highlightImprove && (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col gap-2">
                        <span className="text-zinc-400 text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                          Opportunity to Expand
                        </span>
                        <p className="text-zinc-400 text-xs italic font-light leading-relaxed">
                          &ldquo;{evaluation.highlightImprove}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actionable Recommendations */}
              {evaluation.recommendations.length > 0 && (
                <div className="pt-2 border-t border-zinc-900">
                  <h4 className="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-4">
                    Targeted Action Items
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    {evaluation.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3.5 text-xs text-zinc-300 font-light">
                        <span className="flex-shrink-0 w-5 h-5 rounded-md bg-zinc-800 text-white font-mono text-[10px] font-semibold flex items-center justify-center border border-zinc-700">
                          0{i + 1}
                        </span>
                        <p className="mt-0.5 leading-relaxed">{rec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reset Button */}
              <div className="flex justify-center pt-4">
                <button
                  onClick={resetEvaluation}
                  className="inline-flex items-center gap-2 rounded-full bg-white hover:bg-zinc-200 text-black font-semibold text-xs uppercase tracking-wider px-8 py-3.5 transition-colors cursor-pointer"
                >
                  <RefreshIcon className="w-3.5 h-3.5" />
                  Practice Next Persona
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Animation styling */}
      <style jsx>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Card Sub-component
// ---------------------------------------------------------------------------

function MetricCard({ title, score, notes }: { title: string; score: number; notes: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400 text-xs font-mono uppercase tracking-wider">{title}</span>
        <span className="text-sm font-bold font-mono text-white px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">
          {score}/10
        </span>
      </div>
      <p className="text-zinc-300 text-xs font-light leading-relaxed">{notes}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimalist Icons
// ---------------------------------------------------------------------------

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PhoneOffIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" />
      <path d="M8.09 9.91a16 16 0 0 0-2.6-3.41L6.76 5.23a2 2 0 0 1 .45-2.11c-.339-.907-.573-1.85-.7-2.81A2 2 0 0 1 4.11 2h-3a2 2 0 0 1-2 2.18 19.79 19.79 0 0 0 3.07 8.63c.74 1.18 1.58 2.29 2.53 3.3" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
