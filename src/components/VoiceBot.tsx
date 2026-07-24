"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import personas from "@data/personas.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CallStatus = "idle" | "connecting" | "connected" | "speaking" | "error";

interface Persona {
  id: string;
  name: string;
  role: string;
  industry: string;
  difficulty: string;
  tone: string;
  avatarColor: string;
  background: string;
  objectionStyle: string;
  keyObjections: string[];
  systemPromptInstructions: string;
}

interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
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

// ---------------------------------------------------------------------------
// Colour map – maps persona avatarColor values to Tailwind-compatible classes
// ---------------------------------------------------------------------------

const AVATAR_COLORS: Record<string, { bg: string; ring: string; text: string; badge: string }> = {
  amber:   { bg: "bg-amber-500/20",   ring: "ring-amber-500/40",   text: "text-amber-400",   badge: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  emerald: { bg: "bg-emerald-500/20", ring: "ring-emerald-500/40", text: "text-emerald-400", badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  indigo:  { bg: "bg-indigo-500/20",  ring: "ring-indigo-500/40",  text: "text-indigo-400",  badge: "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30" },
};

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy:   "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  Medium: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  Hard:   "bg-rose-500/15 text-rose-300 ring-rose-500/30",
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

  // Too short?
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

  // ---- Discovery & Questioning ----
  const questionCount = userMsgs.reduce(
    (sum, m) => sum + QUESTION_PATTERNS.filter((p) => p.test(m.text)).length,
    0
  );
  const discoveryRatio = questionCount / Math.max(userMsgs.length, 1);
  const discoveryScore = Math.min(10, Math.round(discoveryRatio * 12 + (questionCount >= 2 ? 2 : 0)));
  const discoveryNotes =
    questionCount === 0
      ? "No discovery questions detected — try asking about their pain points and goals."
      : questionCount <= 2
        ? `Asked ${questionCount} question(s). Good start, but dig deeper into the prospect's needs.`
        : `Strong discovery — asked ${questionCount} questions to understand the prospect's situation.`;

  // ---- Objection Handling ----
  // Check which persona objections surfaced in assistant messages
  const surfacedObjections = persona.keyObjections.filter((obj) =>
    assistantMsgs.some((m) => {
      const normObj = obj.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
      return m.text.toLowerCase().includes(normObj) ||
        obj.toLowerCase().split(/\s+/).some((w) => w.length > 5 && m.text.toLowerCase().includes(w));
    })
  );

  // Check if user responded to those objections (message right after assistant objection)
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
      ? "The prospect didn't raise their key objections — the call may have been too brief."
      : objectionResponses >= surfacedObjections.length
        ? `Addressed ${objectionResponses} of ${surfacedObjections.length} objection(s) raised. Well handled!`
        : `${surfacedObjections.length} objection(s) were raised but only ${objectionResponses} received a substantive response.`;

  // ---- Tone & Professionalism ----
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
      ? `Detected ${negHits} potentially pushy or dismissive phrase(s) — soften your language.`
      : posHits >= 3
        ? "Great rapport-building language — kept the conversation warm and professional."
        : posHits >= 1
          ? "Decent tone. Try adding more empathetic phrases like 'I understand' or 'Great question.'"
          : "Tone was neutral. Adding empathy and acknowledgment phrases will build more trust.";

  // ---- Highlights ----
  // Find the longest user reply right after an assistant objection → good handling
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

  // Don't highlight the same message for both
  if (highlightGood === highlightImprove) highlightImprove = null;

  // Truncate long highlights
  const truncate = (s: string | null, max: number) =>
    s && s.length > max ? s.slice(0, max).trimEnd() + "…" : s;
  highlightGood = truncate(highlightGood, 180);
  highlightImprove = truncate(highlightImprove, 180);

  // ---- Overall Score ----
  const overallScore = Math.min(10, Math.max(1, Math.round((discoveryScore + objectionScore + toneScore) / 3)));

  // ---- Recommendations ----
  const recommendations: string[] = [];
  if (questionCount < 3) {
    recommendations.push("Ask more open-ended discovery questions early in the call to uncover pain points.");
  }
  if (objectionResponses < surfacedObjections.length) {
    recommendations.push(
      "When an objection comes up, acknowledge it first, then share a specific example or data point."
    );
  }
  if (posHits < 2) {
    recommendations.push(
      'Use empathetic language like "I understand" and "Great question" to build rapport.'
    );
  }
  if (recommendations.length < 3 && userMsgs.some((m) => m.text.length < 15)) {
    recommendations.push("Avoid one-word or very short answers — elaborate to show genuine interest.");
  }
  if (recommendations.length < 3) {
    recommendations.push(
      `Tailor your pitch to ${persona.name}'s industry (${persona.industry}) with relevant case studies.`
    );
  }
  if (recommendations.length < 3) {
    recommendations.push("End the call with a clear next step — schedule a follow-up or send materials.");
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
// Score badge colour helpers
// ---------------------------------------------------------------------------

function scoreBadgeColor(score: number): string {
  if (score >= 8) return "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30";
  if (score >= 5) return "bg-amber-500/20 text-amber-300 ring-amber-500/30";
  return "bg-rose-500/20 text-rose-300 ring-rose-500/30";
}

function scoreLabel(score: number): string {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Average";
  if (score >= 3) return "Needs Work";
  return "Poor";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VoiceBot() {
  const [selectedPersona, setSelectedPersona] = useState<Persona>(personas[0] as Persona);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  const vapiRef = useRef<Vapi | null>(null);
  const transcriptRef = useRef<TranscriptMessage[]>([]);
  const personaAtCallStart = useRef<Persona>(selectedPersona);

  // ---- Cleanup helper ----
  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      vapiRef.current.stop();
      vapiRef.current.removeAllListeners();
      vapiRef.current = null;
    }
  }, []);

  // Unmount cleanup
  useEffect(() => cleanup, [cleanup]);

  // ---- Start Call ----
  const startCall = useCallback(async () => {
    const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    if (!publicKey) {
      setCallStatus("error");
      setErrorMessage("Missing NEXT_PUBLIC_VAPI_PUBLIC_KEY in environment.");
      return;
    }

    // Clean up any stale instance
    cleanup();

    // Reset state
    setCallStatus("connecting");
    setErrorMessage(null);
    setEvaluation(null);
    transcriptRef.current = [];
    personaAtCallStart.current = selectedPersona;

    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;

    // --- Event listeners ---
    vapi.on("call-start", () => setCallStatus("connected"));

    vapi.on("call-end", () => {
      // Analyse transcript immediately
      const result = analyseTranscript(transcriptRef.current, personaAtCallStart.current);
      setEvaluation(result);
      setCallStatus("idle");
      setIsMuted(false);
      cleanup();
    });

    vapi.on("speech-start", () => setCallStatus("speaking"));
    vapi.on("speech-end", () => setCallStatus("connected"));

    vapi.on("error", (err) => {
      console.error("[Vapi Error]", err);
      setCallStatus("error");
      setErrorMessage(typeof err === "string" ? err : (err as Error)?.message ?? "An unknown error occurred.");
    });

    // --- Capture transcript messages ---
    vapi.on("message", (msg: Record<string, unknown>) => {
      if (
        msg.type === "transcript" &&
        msg.transcriptType === "final" &&
        typeof msg.transcript === "string" &&
        (msg.role === "user" || msg.role === "assistant")
      ) {
        transcriptRef.current.push({
          role: msg.role as "user" | "assistant",
          text: msg.transcript,
        });
      }
    });

    // Build system prompt from persona data
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
        name: `${selectedPersona.name} – ${selectedPersona.role}`,
        firstMessage: `Hi there! I'm ${selectedPersona.name}, ${selectedPersona.role} at a ${selectedPersona.industry}. What have you got for me today?`,
      });
    } catch (err) {
      console.error("[Vapi Start Error]", err);
      setCallStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to start the call.");
    }
  }, [selectedPersona, cleanup]);

  // ---- End Call ----
  const endCall = useCallback(() => {
    // Trigger call-end flow which runs analysis
    if (vapiRef.current) {
      vapiRef.current.stop();
    } else {
      setCallStatus("idle");
      setIsMuted(false);
    }
  }, []);

  // ---- Practice Again ----
  const resetEvaluation = useCallback(() => {
    setEvaluation(null);
    transcriptRef.current = [];
  }, []);

  // ---- Mute toggle ----
  const toggleMute = useCallback(() => {
    if (vapiRef.current) {
      const next = !isMuted;
      vapiRef.current.setMuted(next);
      setIsMuted(next);
    }
  }, [isMuted]);

  // ---- Derived UI state ----
  const isActive = callStatus === "connected" || callStatus === "speaking";
  const colors = AVATAR_COLORS[selectedPersona.avatarColor] ?? AVATAR_COLORS.amber;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-8 w-full max-w-3xl mx-auto">

      {/* ── Persona Selector ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400 mb-4">
          Choose a Prospect
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(personas as Persona[]).map((p) => {
            const c = AVATAR_COLORS[p.avatarColor] ?? AVATAR_COLORS.amber;
            const active = p.id === selectedPersona.id;

            return (
              <button
                key={p.id}
                disabled={isActive || callStatus === "connecting"}
                onClick={() => { setSelectedPersona(p); setEvaluation(null); }}
                className={[
                  "relative flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-all duration-200",
                  "border backdrop-blur-sm",
                  active
                    ? `border-white/20 bg-white/[0.07] shadow-lg shadow-black/20 ring-1 ${c.ring}`
                    : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/10",
                  (isActive || callStatus === "connecting") ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                {/* Avatar circle */}
                <div className={`flex items-center justify-center w-11 h-11 rounded-full ${c.bg} ${c.text} font-bold text-lg ring-1 ${c.ring}`}>
                  {p.name[0]}
                </div>

                {/* Name & role */}
                <div>
                  <p className="text-white font-semibold text-[15px] leading-tight">{p.name}</p>
                  <p className="text-zinc-400 text-xs mt-0.5">{p.role}</p>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${DIFFICULTY_COLORS[p.difficulty] ?? ""}`}>
                    {p.difficulty}
                  </span>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-zinc-500/10 text-zinc-400 ring-zinc-500/20">
                    {p.industry}
                  </span>
                </div>

                {/* Active indicator dot */}
                {active && (
                  <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-white/70 shadow-[0_0_6px_rgba(255,255,255,0.5)]" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Call Panel ────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-md p-6 flex flex-col items-center gap-6">

        {/* Visual feedback orb */}
        <div className="relative flex items-center justify-center w-32 h-32">
          {/* Pulsing rings when speaking */}
          {callStatus === "speaking" && (
            <>
              <span className={`absolute inset-0 rounded-full ${colors.bg} animate-ping opacity-30`} />
              <span className={`absolute inset-2 rounded-full ${colors.bg} animate-ping opacity-20`} style={{ animationDelay: "150ms" }} />
            </>
          )}

          {/* Spinning ring when connecting */}
          {callStatus === "connecting" && (
            <span className="absolute inset-0 rounded-full border-2 border-t-transparent border-white/30 animate-spin" />
          )}

          {/* Core avatar */}
          <div
            className={[
              "relative z-10 flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300",
              colors.bg,
              `ring-2 ${colors.ring}`,
              callStatus === "speaking" ? "scale-110" : "",
            ].join(" ")}
          >
            <span className={`text-3xl font-bold ${colors.text}`}>
              {selectedPersona.name[0]}
            </span>
          </div>
        </div>

        {/* Status label */}
        <div className="text-center">
          <p className="text-white font-semibold text-lg">{selectedPersona.name}</p>
          <p className="text-zinc-400 text-sm mt-0.5">
            {callStatus === "idle" && !evaluation && "Ready to call"}
            {callStatus === "idle" && evaluation && "Call ended"}
            {callStatus === "connecting" && "Connecting…"}
            {callStatus === "connected" && "On call — listening"}
            {callStatus === "speaking" && `${selectedPersona.name} is speaking…`}
            {callStatus === "error" && (errorMessage ?? "Something went wrong")}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Start */}
          {(callStatus === "idle" || callStatus === "error") && !evaluation && (
            <button
              onClick={startCall}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-medium text-sm px-6 py-2.5 transition-colors shadow-lg shadow-emerald-500/25 cursor-pointer"
            >
              <PhoneIcon className="w-4 h-4" />
              Start Call
            </button>
          )}

          {/* Mute / Unmute */}
          {isActive && (
            <button
              onClick={toggleMute}
              className={[
                "inline-flex items-center gap-2 rounded-full font-medium text-sm px-5 py-2.5 transition-colors cursor-pointer",
                isMuted
                  ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                  : "bg-white/10 text-white hover:bg-white/15",
              ].join(" ")}
            >
              {isMuted ? <MicOffIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4" />}
              {isMuted ? "Unmute" : "Mute"}
            </button>
          )}

          {/* End */}
          {(isActive || callStatus === "connecting") && (
            <button
              onClick={endCall}
              className="inline-flex items-center gap-2 rounded-full bg-rose-500 hover:bg-rose-400 active:bg-rose-600 text-white font-medium text-sm px-6 py-2.5 transition-colors shadow-lg shadow-rose-500/25 cursor-pointer"
            >
              <PhoneOffIcon className="w-4 h-4" />
              End Call
            </button>
          )}
        </div>
      </section>

      {/* ── Evaluation Card ──────────────────────────────────────────────── */}
      {evaluation && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-md p-6 animate-[fadeSlideIn_0.5s_ease-out]">

          {evaluation.tooShort ? (
            /* ---- Too-short notice ---- */
            <div className="flex flex-col items-center gap-4 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
                <ClockIcon className="w-7 h-7 text-amber-400" />
              </div>
              <p className="text-white font-semibold text-lg">Too Short for a Full Review</p>
              <p className="text-zinc-400 text-sm max-w-md">
                Call ended too early for a full evaluation. Try speaking a bit longer!
              </p>
              <button
                onClick={resetEvaluation}
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-sm px-6 py-2.5 transition-colors cursor-pointer"
              >
                <RefreshIcon className="w-4 h-4" />
                Practice Again
              </button>
            </div>
          ) : (
            /* ---- Full evaluation ---- */
            <div className="flex flex-col gap-6">

              {/* Header with overall score */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-lg">Call Evaluation</h3>
                  <p className="text-zinc-400 text-sm mt-0.5">
                    Session with {personaAtCallStart.current.name}
                  </p>
                </div>
                <div className={`flex items-center gap-2.5 rounded-full px-4 py-2 ring-1 ring-inset ${scoreBadgeColor(evaluation.overallScore)}`}>
                  <span className="text-2xl font-bold leading-none">{evaluation.overallScore}</span>
                  <span className="text-xs font-medium opacity-80">/10 · {scoreLabel(evaluation.overallScore)}</span>
                </div>
              </div>

              <hr className="border-white/[0.06]" />

              {/* Metrics grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MetricCard title="Discovery & Questioning" score={evaluation.discovery.score} notes={evaluation.discovery.notes} />
                <MetricCard title="Handling Objections" score={evaluation.objections.score} notes={evaluation.objections.notes} />
                <MetricCard title="Tone & Professionalism" score={evaluation.tone.score} notes={evaluation.tone.notes} />
              </div>

              {/* Transcript highlights */}
              {(evaluation.highlightGood || evaluation.highlightImprove) && (
                <>
                  <hr className="border-white/[0.06]" />
                  <div className="flex flex-col gap-4">
                    <h4 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
                      Transcript Highlights
                    </h4>

                    {evaluation.highlightGood && (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
                        <p className="text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
                          ✓ Strong Moment
                        </p>
                        <p className="text-zinc-300 text-sm italic leading-relaxed">
                          &ldquo;{evaluation.highlightGood}&rdquo;
                        </p>
                      </div>
                    )}

                    {evaluation.highlightImprove && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
                        <p className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-2">
                          △ Room to Improve
                        </p>
                        <p className="text-zinc-300 text-sm italic leading-relaxed">
                          &ldquo;{evaluation.highlightImprove}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Recommendations */}
              {evaluation.recommendations.length > 0 && (
                <>
                  <hr className="border-white/[0.06]" />
                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-widest text-zinc-400 mb-3">
                      Recommendations
                    </h4>
                    <ul className="flex flex-col gap-2.5">
                      {evaluation.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-zinc-300">
                          <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold flex items-center justify-center ring-1 ring-indigo-500/30">
                            {i + 1}
                          </span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {/* Practice Again */}
              <div className="flex justify-center pt-2">
                <button
                  onClick={resetEvaluation}
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium text-sm px-6 py-2.5 transition-colors cursor-pointer"
                >
                  <RefreshIcon className="w-4 h-4" />
                  Practice Again
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Keyframe for fade-slide-in animation */}
      <style jsx>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(16px);
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
// Metric sub-component
// ---------------------------------------------------------------------------

function MetricCard({ title, score, notes }: { title: string; score: number; notes: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-zinc-400 text-xs font-medium">{title}</p>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${scoreBadgeColor(score)}`}>
          {score}/10
        </span>
      </div>
      <p className="text-zinc-300 text-[13px] leading-relaxed">{notes}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (no external dependency)
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
