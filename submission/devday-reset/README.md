# Earlier Resona DevDay experiments

The current entry continues the original Resona app. See the [main README](../../README.md), [slides](../Resona-DevDay.pptx) and [demo script](../Resona-DevDay-script.md). The standalone sensor and Reset experiments below are earlier work, not the current entry.

The earlier sensor experiment uses a phone's microphone and motion sensor for a short check-in. Record a comfortable breath sound, walk for ten seconds, and see sound-level and approximate movement readings. The numbers describe this recording, depend on the device and surroundings, and are not validated health measurements or a medical assessment.

Raw audio and motion samples are processed on the device. A participant can choose to send the extracted numerical readings to the demo server and OpenAI for a note selected from fixed, non-medical options. Those readings can still be personal information. The optional note needs a configured server and private demo link; the readings remain visible if the service is unavailable.

The demo builds on [kitfunso/resona](https://github.com/kitfunso/resona), commit `e35725c`, which predates this hackathon. We reused the React/Vite setup, audio and motion processing, Resona identity and design. Today's work adds the standalone sensor interface, explicit consent to send readings, constrained OpenAI note selection and demo-specific service. Codex helped build these pieces and exercise the flow.

## Suggested narration for the sensor demo

> Resona gives you a quick check-in using the phone you already have. No wearable to charge. First, record a comfortable breath sound. Then take a short walk. Your phone shows the sound level and an estimate of your steps and cadence. These are experimental readings, not a medical assessment. The raw sound and motion stay on your phone. If you choose, we send the numbers to OpenAI to select a short note from fixed options. We built this new demo on our earlier Resona project, and Codex helped us build and test it.

## Earlier Resona Reset prototype

The sections and recordings below document the earlier Reset prototype, not the current sensor demo. Neither video shows the microphone, motion capture or AI-selected note. Both are silent for Keith to narrate.

A private pause for people working, studying or building: check in, take a guided minute, and leave with one practical next step.

## Run the Reset prototype

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

## What was made for the Reset prototype

Built on 1 November 2026 for the DevDay Exchange Community Hackathon in London: the public reset entry, energy and intention check-in, guided timer with pause/resume, reflection, honest next-step card, plain-text download, responsive styling, and new timer/action tests.

There is one complete journey. Your choices stay in React memory in the current tab. There are no sensor requests, account calls, analytics, browser-storage writes or model calls in this entry. Fonts load from Google Fonts; fallback fonts keep the app usable if they fail. Reloading clears the check-in. Saving downloads only the card you can already see.

Suggestions come from a local rule table. The product does not claim AI-generated advice, clinical measurements, diagnosis or a measured improvement in wellbeing.

## Existing work and assets

Base: [kitfunso/resona](https://github.com/kitfunso/resona), commit `e35725c`, which predates this hackathon. Reused: React/Vite workspaces, build configuration, Resona name and tagline, warm ink/cream/brass design language, and the existing font choices. The original authenticated product remains at `/` and is separate from the new sensor demo.

Fonts: Young Serif, Manrope and JetBrains Mono, served through Google Fonts as in the original app. The result uses AI-generated artwork made for this entry with Codex's built-in image tool; the tool did not report its model version. No stock photography, paid asset pack or copied template was added. The small favicon is a text monogram made for this entry.

The Reset app uses no live model calls. Generated image and voice experiments are separate from the sensor app; Keith will record the demo narration himself.

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

Suggested narration for the shorter edit, adapted from the earlier Resona pitch outline:

> Resona gives you a quick check-in on your phone, with no app to install or wearable to charge. Choose how you're feeling and what you need, then follow the breathing guide at your own pace. Afterwards, choose what you notice and you'll get a small next step you can save. Your choices stay in your browser. We built this new experience on our earlier Resona project, and Codex helped us build and test the breathing timer.

## Verification limits

See [the local evidence page](../../docs/devday-reset.html). Chromium was checked at phone, tablet and desktop widths, including keyboard controls and reduced motion. Tab-hide pause was checked by a simulated `visibilitychange` event because the headless browser did not report a real tab as hidden. A real Safari or phone backgrounding check remains for rehearsal. No server or database code changed, so their suites were not part of this feature's checks.

The [public preview](https://feat-devday-reset.resona-dmf.pages.dev/reset) is a static deployment of the earlier Reset prototype. It does not show the current sensor demo.
