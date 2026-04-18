# Resona at Work — Pitch Outline

Watcha Global AI Hackathon 2026 · London · Sunday 19 April

Target length: 2 minutes, 5 slides. Pure spoken flow, no reading off the deck.

---

## Slide 1 · Hook

**Visual:** a photo of a typical open-plan office at 3pm. People slumped at desks.

**Spoken (~15s):**

> Knowledge workers in the UK spend **9 hours a day sitting**. That's more than they sleep. Sedentary behaviour costs British business billions in productivity and drives the diseases the NHS is already buckling under: cardiovascular, metabolic, respiratory.

**Key stat on screen:** 9.5 hrs/day average sitting time · £7.4bn/yr UK productivity loss (source the actual number before Sunday).

---

## Slide 2 · Problem

**Visual:** a wall of logos: Fitbit, Oura, Whoop, Apple Watch, Wellable. Struck through.

**Spoken (~20s):**

> Corporate wellness today is **expensive hardware** nobody wears, **passive surveillance** nobody trusts, or **one-off PDFs** from HR nobody reads. There is no daily, private, hardware-free way for a whole team to check in on their health and their movement. Until now.

**Key line on screen:** "Wellness without wearables."

---

## Slide 3 · Solution

**Visual:** 3-column infographic. Breath. Motion. (Heart — greyed out, "next module"). Each icon sitting on a phone silhouette.

**Spoken (~30s):**

> Resona turns any smartphone into a 2-minute team health check-in. No apps to install. No wearables to charge. Three signals, extracted from sensors every employee already carries:
>
> - **Breath** — lung function from the phone microphone. Acoustic spirometry. We use Hankinson NHANES III reference equations.
> - **Motion** — tremor and gait from the phone's accelerometer. Standing-up streaks, stillness, stride variability.
> - **(Coming Q3)** **Heart** — resting HR and HRV from a 30-second face video, using rPPG.
>
> All processing happens on the phone. Only the extracted numbers touch the server. No audio, no video, no GPS leave your pocket.

---

## Slide 4 · Live demo

**Visual:** the actual projector URL open on the stage screen. QR code front and centre.

**Spoken (~40s):**

> You are going to try this live. Scan the QR code on the screen. Enter a team code — use ENG, DESIGN, or SALES. Then blow into the bottom of your phone for six seconds. You will see a personalised report, a copy-paste-able GP letter written by GLM-5.1, and your team's combined lung capacity fill the bar on this screen. First team to 300 litres wins.
>
> [live blow, wait ~20s, point at the updating bar]
>
> That's it. That's the product. Run it every Monday at 11am, everyone on a call. HR gets the team-level dashboard. Employees get their own numbers, never shared without consent.

---

## Slide 5 · Business + ask

**Visual:** simple pricing table. "£3 per seat per month." "Roadmap: Heart (Q3), Sleep (Q4), Mental load (2027)."

**Spoken (~30s):**

> **Model:** per-seat SaaS, £3/employee/month. Compared to Fitbit-for-work at £12/seat with 40% drop-off in month 3, we have zero hardware cost, zero drop-off risk, and a daily touchpoint.
>
> **Go-to-market:** Slack and Teams integrations day one. Nudge at 2pm: "Resona check-in due."
>
> **Roadmap:** Heart in Q3 via rPPG. Sleep telemetry via overnight phone accelerometer. Mental-load screening via voice stress markers. Same phone. Same 2 minutes. More body systems.
>
> **The ask:** Watcha's enterprise network. We are ready to pilot with 5 Watcha portfolio companies on Monday.

---

## Speaker notes / cut-downs

- **If demo fails:** pivot to the GP letter. Pull up a cached copy, read a paragraph aloud. "Written by GLM-5.1 from your numbers, not a template."
- **If questions go long:** the answer to most "does it work for X?" is "yes, because we are extracting signals, not audio. Works equally well in any language."
- **If asked about data:** SQLite in-memory, cleared on server restart. Pitch day state dies Sunday night. Production plan = per-tenant encrypted Postgres, SOC2 roadmap.
- **If asked why GLM-5.1 and not GPT:** Z.ai is Watcha's strategic partner, their model handles structured JSON extraction reliably and runs with zero reasoning latency when we disable the thinking mode, which we do for all customer-facing calls.

---

## One-liner for the badges / lanyard

> Resona at Work. Every body has a rhythm. Now every team has one too.
