# AGENTS.md - Resona

## Project
- Phone-based 2-minute team wellness check-in built for Watcha Global AI Hackathon 2026.
- Stack: Node/Express + ws + React 18 + Vite, with server/client/shared workspaces.
- Privacy rule: raw audio, video, motion, and GPS should stay local. Only extracted numerical features should touch the server.

## Commands
```bash
npm run dev
npm run dev:server
npm run dev:client
npm run test:gpt
```

## Rules
- Treat health claims carefully. Avoid medical diagnosis language unless explicitly scoped and reviewed.
- Keep all signal processing privacy-preserving by default.
- Do not commit `.env`, logs, raw recordings, or personal data.
- Browser QA matters: test phone-sized viewports and permission-denied states.
- Keep hackathon/demo constraints visible before adding production-grade scope.

## Never Do
- Never upload raw audio, video, motion streams, or GPS by default.
- Never make diagnostic or treatment claims from wellness signals.
- Never commit `.env`, `llm-trace.log`, raw recordings, or identifiable health data.
- Never build team reporting that exposes individual sensitive measurements without consent.
- Never add server-side retention of raw sensor data without an explicit privacy review.
