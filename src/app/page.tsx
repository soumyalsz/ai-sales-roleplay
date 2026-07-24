import VoiceBot from '@/components/VoiceBot';

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-start p-6 md:p-12 font-sans selection:bg-white selection:text-black">
      <header className="max-w-4xl w-full text-center mb-12 pt-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-mono mb-6 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          AI Voice Roleplay Platform
        </div>
        <h1 className="text-4xl md:text-6xl font-semibold tracking-tight text-white mb-4">
          Master the Sales Pitch.
        </h1>
        <p className="text-zinc-400 text-base md:text-lg max-w-2xl mx-auto font-light leading-relaxed">
          Select a customer persona, practice handling real-time objections over live audio, and receive an instant AI evaluation of your call transcript.
        </p>
      </header>

      <div className="w-full max-w-4xl">
        <VoiceBot />
      </div>
    </main>
  );
}
