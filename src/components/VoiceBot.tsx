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
// Component
// ---------------------------------------------------------------------------

export default function VoiceBot() {
  const [selectedPersona, setSelectedPersona] = useState<Persona>(personas[0] as Persona);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const vapiRef = useRef<Vapi | null>(null);

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

    setCallStatus("connecting");
    setErrorMessage(null);

    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;

    // --- Event listeners ---
    vapi.on("call-start", () => setCallStatus("connected"));
    vapi.on("call-end", () => {
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
    cleanup();
    setCallStatus("idle");
    setIsMuted(false);
  }, [cleanup]);

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
                onClick={() => setSelectedPersona(p)}
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
            {callStatus === "idle" && "Ready to call"}
            {callStatus === "connecting" && "Connecting…"}
            {callStatus === "connected" && "On call — listening"}
            {callStatus === "speaking" && `${selectedPersona.name} is speaking…`}
            {callStatus === "error" && (errorMessage ?? "Something went wrong")}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Start */}
          {(callStatus === "idle" || callStatus === "error") && (
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
