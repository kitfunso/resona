# Resona Reset

A private pause for people working, studying or building: check in, take a guided minute, and leave with one practical next step.

## Run

Use Node 20 or later. From the repository root:

```sh
npm ci
npm run dev:client
```

Open `http://localhost:5174/reset.html`. This entry needs no environment file, account, database or API key. The original sensor app at `/` has separate setup requirements in the main README.

```sh
npm test --workspace=client
npm run build --workspace=client
npm run preview --workspace=client -- --host 127.0.0.1 --port 5188
```

The production entry is `http://127.0.0.1:5188/reset.html`. Deploy the built `client/dist` directory to a static host for a public demo. The public URL is not configured by these commands.

## What was made today

Built on 1 November 2026 for the DevDay Exchange Community Hackathon in London: the public reset entry, energy and intention check-in, guided timer with pause/resume, reflection, honest next-step card, plain-text download, responsive styling, and new timer/action tests.

There is one complete journey. Your choices stay in React memory in the current tab. There are no sensor requests, account calls, analytics, browser-storage writes or model calls in this entry. Fonts load from Google Fonts; fallback fonts keep the app usable if they fail. Reloading clears the check-in. Saving downloads only the card you can already see.

Suggestions come from a local rule table. The product does not claim AI-generated advice, clinical measurements, diagnosis or a measured improvement in wellbeing.

## Existing work and assets

Base: [kitfunso/resona](https://github.com/kitfunso/resona), commit `e35725c`, which predates this hackathon. Reused: React/Vite workspaces, build configuration, Resona name and tagline, warm ink/cream/brass design language, and the existing font choices. The original authenticated sensor product remains at `/` and is not today's entry.

Fonts: Young Serif, Manrope and JetBrains Mono, served through Google Fonts as in the original app. The result uses AI-generated artwork made for this entry with Codex's built-in image tool; the tool did not report its model version. No stock photography, paid asset pack or copied template was added. The small favicon is a text monogram made for this entry.

The optional spoken guide is prepared but unavailable until the generated audio files are supplied. GPT Image 2.5 artwork and OpenAI voice generation are pending a valid API key; no live model calls are made by the app.

## How Codex helped

Codex inspected the existing source and project rules, isolated the build from unfinished local work, and proposed the new journey. An independent reviewer read the plan before implementation and read the resulting source after self-review.

A concrete example: Codex made the breathing dial read the same elapsed time as the countdown. Pausing and resuming therefore preserves the visual phase and remaining session time. Tests cover late callbacks, paused time, repeated starts, phase boundaries and early finishes. Codex also exercised a real full minute in Chromium and checked the downloaded text.

## Demo recording and narration

`resona-reset-demo.mp4` is the silent screen recording for Keith to narrate. It shows a real guided minute; the timer is not accelerated. The choices in the recording are synthetic demonstration inputs.

`resona-reset-visual-demo.mp4` is the shorter visual edit, also silent for Keith's narration. The breathing footage is shortened and labelled in the video. The app itself still offers the full minute.

The visual edit uses `reset-demo-art.png`, an illustration generated with Codex's built-in image tool for the video. This artwork is a demo asset, not an image-generation feature in the app. The built-in tool did not report its model version.

Image prompt: "Use case: stylized-concept. Asset type: opening background for a short wellness app demo film. Create an evocative, playful but calm dreamlike miniature paper sculpture: a softly glowing brass sun rising above layered cream paper hills, gentle concentric ripples like breathing, a tiny path winding toward the light, subtle tactile paper texture. Elegant modern editorial design in warm ivory, ink black and muted brass, lively yet restful, not childish. Wide landscape composition, generous calm negative space for a title to be added later. No text, letters, interface, logos, watermark, or people."

Suggested narration:

> This is Resona Reset: a private pause with one useful next step. I choose how I am arriving and what I need, then take a guided minute. I can pause or stop at any point. Afterwards, I say what I actually notice. The result reflects that answer and gives me one small action I can save. Nothing from my check-in leaves this tab. Today's new journey builds on our earlier Resona project. Codex helped inspect the code, build the journey, test the timing and check the working flow. The suggestions use local rules; Codex helped make the product.

Suggested narration for the shorter edit:

> Meet Resona Reset. Pick how you arrive and what you need. Follow the breathing dial at your own pace, then say what you notice. Resona gives you one small next step you can save. Your check-in stays in this tab. We built this new experience on our earlier Resona project, with Codex helping us get the timing right.

## Verification limits

See [the local evidence page](../../docs/devday-reset.html). Chromium was checked at phone, tablet and desktop widths, including keyboard controls and reduced motion. Tab-hide pause was checked by a simulated `visibilitychange` event because the headless browser did not report a real tab as hidden. A real Safari or phone backgrounding check remains for rehearsal. No server or database code changed, so their suites were not part of this feature's checks.

The public link, narration and event submission remain separate final steps. Do not submit the old Resona product as today's work.
