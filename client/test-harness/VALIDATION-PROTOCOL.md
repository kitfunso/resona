# Module 03 (Heart) — measurement validation protocol

Automated tests prove the **code** is correct (DSP recovers a known signal; the camera
path recovers a synthetic pulse; bad signal is refused). They do **not** prove the camera
reads a real person's true heart rate. That requires comparing rPPG output against a
reference device. This is the evidence grants / MHRA / any clinical reviewer will ask for.

## What you need
- A **reference HR device** measured at the same time as the capture:
  - fingertip **pulse oximeter** (~£15) — fine for HR. Adequate, cheapest.
  - or a **chest-strap** (Polar H10) — better, near-ECG HR timing.
- Note: a pulse-ox is **not** good enough to validate **HRV** (RMSSD/SDNN). HRV needs ECG
  ground truth. Until then, treat HRV as exploratory and **do not make HRV claims**.

## How to run a session
1. `node client/test-harness/serve-validate.mjs`
2. Open `http://localhost:5198/test-harness/validate.html` on **this laptop** (webcam, secure
   localhost). For the real **phone** form factor, `ngrok http 5198` and open the HTTPS URL on the phone.
3. Put the reference device on. Sit still, face centred, even lighting.
4. Click **Start 30s capture**. When it finishes, read the reference HR off the device and
   type it in, set lighting / activity / skin (Fitzpatrick), **Save reading**.
5. Repeat to build up readings (see targets below). **Export CSV** when done.
6. `node client/test-harness/analyze-validation.mjs resona-validation.csv`

## How many readings, and across what
- **Minimum sanity check:** >= 20 paired readings, one subject, spanning a range of heart
  rates. Vary HR deliberately: rest, then after stairs / jumping jacks (post-exercise),
  so you cover ~50-130 bpm. A validation that only ever sees 70 bpm proves little.
- **Grant / clinical grade:** >= 10 subjects, multiple readings each, across:
  - **Lighting**: bright, normal, dim (rPPG degrades in low light).
  - **Skin tone**: a spread of **Fitzpatrick I-VI**. This is the single most important axis
    — rPPG is well documented to lose accuracy on darker skin, and a study that skips it
    will be (rightly) discounted. The existing Hankinson/NHANES caveat in the app is the
    same class of problem.
  - **Motion**: still vs slight movement.

## Acceptance bars
- **Consumer-wearable grade** (what the analyzer checks): MAE <= 5 bpm AND 95% limits of
  agreement within +/-10 bpm.
- **Clinical reference** (ANSI/AAMI EC13, pulse rate meters): within **+/-5 bpm or +/-10%**,
  whichever is greater. This is the bar to cite when framing for MHRA / NIHR i4i / SBRI.
- Report **Bland-Altman** (bias + limits of agreement), not just correlation. A high Pearson
  r with a large bias still fails — reviewers know this.

## What this harness does and does NOT cover
- DOES: the real `recorder.js` capture + `features.js` extraction on a real face/camera.
- Does NOT: face-detected ROI placement (it uses centred **fallback** ROIs to stay
  dependency-free). The shipped app uses MediaPipe face-detect ROIs. For the definitive
  study, validate through the actual phone app so ROI selection is included.
- HRV: not validated here. Needs ECG. Park HRV claims until then.

## Honest expectation
rPPG HR on a still, well-lit face is usually achievable to within a few bpm. The risks that
sink studies are low light, darker skin tones, and motion. Find those limits early and state
them — a screening tool with a known, declared operating envelope is fundable; one that
claims universal accuracy is not.
