# Resona Privacy Policy

> **DRAFT — not legal advice.** This document is an engineering-authored
> starting point. It reflects how the system actually handles data as built,
> but it must be reviewed and finalised by a qualified data-protection lawyer
> before it is published or relied upon. Bracketed `[...]` items need real
> values.

**Effective date:** `[DATE]`
**Data controller for this policy:** `[LEGAL ENTITY NAME, ADDRESS]`
**Contact:** `[privacy@resona.example]`

## 1. What Resona is

Resona is a workplace wellness check-in tool. An employee completes three
short biosignal checks on their own phone — a breath check, a motion check,
and a heart check — and receives a personalised, plain-language report.

**Resona is a screening and wellbeing tool. It is not a medical device and it
does not provide a medical diagnosis.** Reports should not be used as a
substitute for professional medical advice.

## 2. The roles

Resona is sold to employers ("organisations"). For the personal data of an
organisation's employees:

- the **organisation is the data controller** — it decides that its staff
  may use Resona;
- **Resona (`[LEGAL ENTITY]`) is the data processor** — it processes that
  data on the organisation's instructions.

The contract governing that relationship is the Data Processing Agreement
(`docs/DPA.md`).

## 3. What data is collected

### 3.1 Processed on your device and never sent to us

The most sensitive raw signals never leave the phone:

- **Audio** from the breath check is analysed in the browser.
- **Motion sensor data** from the motion check is analysed in the browser.
- **Camera frames** from the heart check are reduced, in the browser, to
  per-frame average colour values for small regions of the face. Raw images
  and video are never transmitted and never stored.

We do not receive raw audio, raw video, or location data.

### 3.2 Sent to and stored by Resona

- **Account data:** your email address, and the profile you enter — name,
  date of birth, height, sex, and ethnicity. Sex, height, age, and ethnicity
  are used because the breath and heart reference ranges depend on them.
- **Check-in data:** the *extracted numerical features* of each check (for
  example, estimated lung-function values, heart-rate variability metrics,
  tremor frequency bands) and the generated report text. No raw recordings.
- **Authentication data:** short-lived, single-use sign-in codes (stored
  hashed) and a session token.

### 3.3 Collected automatically

Standard server logs (IP address, timestamps, request paths) for security and
debugging.

## 4. How the data is used

- To run the checks and generate your personalised report.
- To show your own history of check-ins over time.
- To provide the employer with **aggregated, de-identified** wellbeing trends.
  `[Confirm the aggregation/anonymisation model once the admin dashboard is
  built — see docs/superpowers/plans for the dashboard plan. Until then, no
  employer-facing reporting exists.]`
- To secure the service and prevent abuse.

We do **not** sell personal data. We do **not** use it for advertising.

## 5. Third parties (sub-processors)

To generate a report, the extracted numerical features and the demographic
fields listed in 3.2 are sent to our LLM provider. We also use a hosting
provider, a managed database provider, and an email provider.

| Sub-processor | Purpose | Data shared |
|---------------|---------|-------------|
| OpenAI | Generates the report text | Check-in features + demographics (no name/email) |
| `[Hosting provider]` | Runs the application | All stored data |
| `[Database provider]` | Stores the data | All stored data |
| `[Email provider]` | Sends sign-in codes | Email address |

The current list of sub-processors is maintained in the DPA.

## 6. Legal basis (UK GDPR / EU GDPR)

`[To be confirmed with counsel.]` Processing is expected to rest on the
employer's legitimate interests and/or the performance of the employer's
arrangement with its staff, with explicit consent relied on where required for
health-related data. Health-related data is a special category under
Article 9; the lawful condition for processing it must be confirmed by counsel.

## 7. Retention

- **Check-in data and account data:** retained while the employee's account
  is active, then deleted `[N]` days after the account is closed or the
  employer's contract ends.
- **Sign-in codes:** deleted within minutes — they expire after 10 minutes
  and are removed once used or expired.
- **Server logs:** retained `[N]` days.

## 8. Your rights

Subject to applicable law, you may request access to, correction of, or
deletion of your personal data, and may object to or restrict processing.
Because the employer is the controller, requests are normally directed to your
employer; Resona will assist the employer in fulfilling them. Contact
`[privacy@resona.example]`.

## 9. Security

- Raw biosignals are never transmitted (see 3.1).
- Sign-in is passwordless; codes are single-use, expire in 10 minutes, and are
  stored only as hashes.
- Sessions use signed, http-only cookies.
- Each organisation's data is logically separated.
- Traffic is encrypted in transit (HTTPS).

No system is perfectly secure; we cannot guarantee absolute security.

## 10. International transfers

`[Specify where data is hosted and the transfer mechanism for any sub-processor
outside the UK/EEA — e.g. OpenAI processing in the US under Standard
Contractual Clauses.]`

## 11. Changes

We may update this policy. Material changes will be communicated through your
employer.

## 12. Contact

`[privacy@resona.example]` — `[LEGAL ENTITY NAME, ADDRESS]`.
