# AI Sales Roleplay Bot

A real-time voice bot that roleplays as a customer so sales reps can practice pitching, handling objections, and closing deals over an interactive voice call.

---

## Live Demo

**[Try the Live Web App](https://ai-sales-roleplay-6m54vbhxr-excape.vercel.app/)**

---

## How to Use the Website

1. **Open the App:** Visit the [Live Vercel Link](https://ai-sales-roleplay-6m54vbhxr-excape.vercel.app/).
2. **Enter Your Vapi Key:** Paste your Vapi Public Key into the BYOK (Bring Your Own Key) text box and click **Save Key**.
3. **Select a Persona:** Choose a customer profile from the dropdown (e.g., *Dimitri Ivanov* for Easy Mode or *Kushagra* for VP of Engineering Hard Mode).
4. **Start the Call:** Click **Start Call** and grant microphone permissions when prompted.
5. **Roleplay:** Speak directly to the AI customer. Practice handling their objections and pitching your value proposition in real time.
6. **View Feedback:** Click **End Call** to disconnect and instantly view your post-call AI performance evaluation scorecard.

---

## Key Features

* **Sub-Second Voice WebRTC:** Low-latency spoken dialogue powered by the Vapi.ai SDK.
* **Dynamic JSON Personas:** Flexible customer scenarios configured cleanly in `src/data/personas.json`.
* **Bring Your Own Key (BYOK):** Client-side key management saved locally in `localStorage` for privacy and zero infrastructure cost.
* **Post-Call AI Evaluation:** Serverless LLM analysis providing a score and detailed feedback on objection handling after each call.

---

## Tech Stack

* **Frontend:** Next.js (App Router), React, Tailwind CSS
* **Voice Stream:** Vapi.ai Web SDK (`@vapi-ai/web`)
* **STT / LLM / TTS:** Deepgram Nova-2 + OpenAI `gpt-4o` + ElevenLabs / PlayHT
* **Hosting:** Vercel
