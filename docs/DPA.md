# Data Processing Agreement (DPA)

> **DRAFT — not legal advice.** This is an engineering-authored starting point
> structured around UK GDPR / EU GDPR Article 28. It must be reviewed and
> finalised by a qualified data-protection lawyer before it is offered to or
> signed with any customer. Bracketed `[...]` items need real values.

This Data Processing Agreement forms part of the agreement between:

- **`[CUSTOMER LEGAL NAME]`** ("Customer", the **data controller**), and
- **`[RESONA LEGAL ENTITY]`** ("Resona", the **data processor**)

for the provision of the Resona workplace wellness service (the "Service").

## 1. Subject matter and duration

Resona processes personal data on behalf of the Customer solely to provide the
Service. Processing lasts for the term of the main agreement and the limited
wind-down period in Section 9.

## 2. Nature and purpose of processing

Resona processes personal data to: authenticate employees; run breath, motion,
and heart check-ins; generate personalised reports; store check-in history;
and `[once built]` produce aggregated, de-identified wellbeing trends for the
Customer.

Raw audio, raw video, and motion-sensor streams are processed entirely on the
employee's device and are never transmitted to Resona. Resona receives only
extracted numerical features and report text.

## 3. Categories of data subjects and personal data

**Data subjects:** the Customer's employees who use the Service.

**Personal data:**

- Identity and contact: email address, name.
- Profile: date of birth, height, sex, ethnicity.
- Health-related data (special category, Article 9): extracted biosignal
  features (lung-function estimates, heart-rate variability metrics, tremor
  metrics) and generated report text.
- Technical: IP address, timestamps, server logs.

The Customer must not instruct Resona to process special-category data beyond
what the Service requires.

## 4. Obligations of Resona (processor)

Resona shall:

1. process personal data only on the Customer's documented instructions,
   including this DPA and the Customer's use of the Service;
2. ensure persons authorised to process the data are bound by confidentiality;
3. implement the technical and organisational measures in Schedule A;
4. engage sub-processors only under Section 5;
5. assist the Customer, taking into account the nature of processing, in
   responding to data-subject requests (Section 6);
6. assist the Customer with security, breach notification, and data-protection
   impact assessments (Articles 32–36);
7. on request, make available information necessary to demonstrate compliance
   and allow for and contribute to audits (Section 8);
8. notify the Customer without undue delay, and in any event within `[72]`
   hours, on becoming aware of a personal-data breach;
9. inform the Customer if, in its opinion, an instruction infringes data
   protection law.

## 5. Sub-processors

The Customer grants general authorisation for the sub-processors listed in
Schedule B. Resona shall:

- impose data-protection obligations on each sub-processor equivalent to those
  in this DPA;
- remain liable for each sub-processor's performance;
- give the Customer `[30]` days' notice of any intended addition or
  replacement, during which the Customer may object on reasonable grounds.

## 6. Data-subject rights

Resona shall, by appropriate technical and organisational measures and insofar
as possible, assist the Customer in fulfilling its obligation to respond to
requests to exercise data-subject rights (access, rectification, erasure,
restriction, portability, objection).

## 7. Security

Resona shall implement and maintain the measures described in Schedule A,
appropriate to the risk of processing health-related data.

## 8. Audit

Resona shall make available to the Customer information reasonably necessary to
demonstrate compliance with this DPA, and shall allow for and contribute to
audits conducted by the Customer or an auditor it mandates, no more than
`[once per year]` except where required by a supervisory authority, on
reasonable notice and subject to confidentiality.

## 9. Return and deletion

On termination of the Service, Resona shall, at the Customer's choice, delete
or return all personal data and delete existing copies, within `[N]` days,
unless retention is required by law.

## 10. International transfers

Resona shall not transfer personal data outside the UK/EEA except where an
appropriate safeguard under applicable data protection law is in place (for
example, Standard Contractual Clauses / the UK International Data Transfer
Addendum). Transfers arising from sub-processors are identified in Schedule B.

## 11. Liability

Liability under this DPA is subject to the limitations in the main agreement.
`[Confirm with counsel — Article 82 allocates liability between controller and
processor and cannot be fully contracted away.]`

---

## Schedule A — Technical and organisational measures

- Raw audio, video, and motion data are processed only on the data subject's
  device and never transmitted to Resona.
- Passwordless authentication: sign-in codes are single-use, expire after 10
  minutes, and are stored only as bcrypt hashes.
- Sessions use signed, http-only, `SameSite` cookies.
- Multi-tenant isolation: each organisation's records are scoped by
  organisation identifier on every query.
- Encryption in transit (HTTPS/TLS).
- Encryption at rest: `[confirm with hosting/database provider]`.
- Rate limiting on authentication and administrative endpoints.
- Administrative endpoints gated by a secret token compared in constant time.
- Least-privilege access to production systems; access logged.
- Prompt/PII redaction in any diagnostic LLM tracing, which is disabled by
  default in production.

## Schedule B — Sub-processors

| Sub-processor | Function | Location | Transfer safeguard |
|---------------|----------|----------|--------------------|
| OpenAI | LLM report generation | `[US]` | `[SCCs / UK IDTA]` |
| `[Hosting provider]` | Application hosting | `[region]` | `[—]` |
| `[Database provider]` | Managed Postgres | `[region]` | `[—]` |
| `[Email provider]` | Transactional email | `[region]` | `[—]` |

---

**Signed for the Customer:** `[NAME, TITLE, DATE]`
**Signed for Resona:** `[NAME, TITLE, DATE]`
