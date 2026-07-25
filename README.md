# AI Sales Roleplay Bot

[cite_start]A real-time voice bot that roleplays as a customer so sales reps can practice pitching, handling objections, and closing deals over an interactive voice call[cite: 1, 3, 755].

---

## Live Demo

**[Try the Live Web App](https://ai-sales-roleplay-6m54vbhxr-excape.vercel.app/)**

---

## How to Use the Website

1. [cite_start]**Open the App:** Visit the [Live Vercel Link](https://ai-sales-roleplay-6m54vbhxr-excape.vercel.app/)[cite: 756].
2. [cite_start]**Enter Your Vapi Key:** Paste your Vapi Public Key into the BYOK (Bring Your Own Key) text box and click **Save Key**[cite: 431, 445, 757].
3. [cite_start]**Select a Persona:** Choose a customer profile from the dropdown (e.g., *Dimitri Ivanov* for Easy Mode or *Kushagra* for VP of Engineering Hard Mode)[cite: 296, 396, 758].
4. [cite_start]**Start the Call:** Click **Start Call** and grant microphone permissions when prompted[cite: 109, 330, 759].
5. [cite_start]**Roleplay:** Speak directly to the AI customer[cite: 2, 760]. [cite_start]Practice handling their objections and pitching your value proposition in real time[cite: 3, 361, 761].
6. [cite_start]**View Feedback:** Click **End Call** to disconnect and instantly view your post-call AI performance evaluation scorecard[cite: 33, 114, 762].

---

## Key Features

* [cite_start]**Sub-Second Voice WebRTC:** Low-latency spoken dialogue powered by the Vapi.ai SDK[cite: 21, 31, 763].
* [cite_start]**Dynamic JSON Personas:** Flexible customer scenarios configured cleanly in `src/data/personas.json`[cite: 28, 488, 764].
* [cite_start]**Bring Your Own Key (BYOK):** Client-side key management saved locally in `localStorage` for privacy and zero infrastructure cost[cite: 431, 445, 765].
* [cite_start]**Post-Call AI Evaluation:** Serverless LLM analysis providing a score and detailed feedback on objection handling after each call[cite: 33, 36, 114, 766].

---

## Tech Stack

* [cite_start]**Frontend:** Next.js (App Router), React, Tailwind CSS [cite: 30, 104, 767]
* [cite_start]**Voice Stream:** Vapi.ai Web SDK (`@vapi-ai/web`) [cite: 30, 767]
* [cite_start]**STT / LLM / TTS:** Deepgram Nova-2 + OpenAI `gpt-4o` + ElevenLabs / PlayHT [cite: 320, 338, 350, 767]
* [cite_start]**Hosting:** Vercel [cite: 429, 767]
