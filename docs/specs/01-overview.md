# 01 Overview

## Purpose

YAXB is a self-service kiosk for a healthcare organisation. Visitors ask questions by voice or text, in their own language, and get factual answers drawn from the organisation's approved knowledge and the documents they bring, each with its source. The kiosk also runs guided services (checking in for a visit, summarising a document, translating), and passes anything that needs a person to the moderation team.

## Who it is for

- **Visitors**: patients, their families, staff and the public, at a shared kiosk or on their own device. They may be unfamiliar with technology, may not read English, and may be unwell or anxious.
- **Moderators**: staff who review escalated questions, add context and references to answers, and rate them so the kiosk's quality can be measured (07).
- **The organisation (YAXB)**: decides what the kiosk knows, which AI providers it may use, who moderates, and where data is kept.

## Principles

These apply to every specification. A requirement that conflicts with one of them is wrong.

| ID | Principle | Status |
|---|---|---|
| OVR-1 | **Facts, not opinions.** Answers state what a source says, name the source, and give no opinions, recommendations or remarks of the kiosk's own. | Built |
| OVR-2 | **Safety first.** A possible emergency gets the emergency line and is escalated, whatever else happens. The kiosk gives general information, never a diagnosis or treatment. | Built |
| OVR-3 | **Say when it doesn't know.** When nothing covers a question, the kiosk says so plainly instead of guessing. | Built |
| OVR-4 | **Private by default.** What the visitor says, their documents and their profile stay on their device unless a feature they chose needs otherwise, and the kiosk says when that happens. | Built |
| OVR-5 | **Their language.** Everything a visitor reads or hears can be in the language they chose. | Built (answers, speech); Planned (screens, LNG-8) |
| OVR-6 | **Untrusted text stays data.** Documents, web pages, tool results and anything a visitor uploads are read as data; instructions inside them are never followed. | Built |
| OVR-7 | **Works without the internet where it can.** On-device models keep core features (search, curated answers, summaries, translation) working offline once loaded. | Built |
| OVR-8 | **Accessible.** Usable by voice alone, by keyboard alone, and with a screen reader; text meets WCAG 2.2 AA contrast. | Built (voice, keyboard); review pending |

## Surfaces

The same core (yaxb-core) runs behind every surface, so behaviour is the same wherever a visitor meets the kiosk. See 10.

| Surface | Status |
|---|---|
| Web kiosk (browser, Cloudflare Workers) | Built |
| Native app (Android, iOS) | Planned (10-PLT-10) |
| Command line (`yaxb`) | Built |
| Local box (Raspberry Pi storage) | Built |
| Voice device (ESP32-S3) | Planned, design only |

## Out of scope

- Diagnosis, triage decisions, prescriptions or any clinical decision.
- Storing identity documents, ID numbers or full dates of birth.
- Payments.
