# 03 Knowledge

What the kiosk answers from, and how it finds the right passage.

## Sources

| ID | Requirement | Status |
|---|---|---|
| KNW-1 | **Curated knowledge base.** The kiosk must ship with Q&A approved by moderators, each with an id, question, answer, category and a *red flag* marker, grouped under named knowledge sources with their moderator, curator and baseline date. | Built |
| KNW-2 | Visitors must be able to see what the kiosk's knowledge comes from (the Knowledge Sources screen). | Built |
| KNW-3 | **Notebooks.** A visitor must be able to add their own documents (text, Markdown, CSV, JSON, HTML, PDF), read in the browser and never uploaded, to a notebook the assistant reads and cites as `notebook:<id>`. | Built |
| KNW-4 | A notebook must hold up to 40 sources and 2,000,000 characters, and say so when full. | Built |
| KNW-5 | Each notebook must keep a memory of lasting preferences and corrections, which the visitor can read and edit, and which never holds identifiers or health details. | Built |

## Websites as sources

| ID | Requirement | Status |
|---|---|---|
| KNW-20 | A visitor (or moderator, for the knowledge base) must be able to add a website to a notebook by its address. The kiosk fetches the page, keeps its readable text (no scripts, navigation or ads), and stores it as a source with its title, address and the date it was read. | Planned |
| KNW-21 | Pages must be fetched by the server, not the browser (browsers block most cross-site reads), with these limits: http(s) only; no private, local or link-local addresses (no requests to the kiosk's own network); at most 2 MB; at most 10 seconds; redirects re-checked against the same rules. | Planned |
| KNW-22 | A website source must be refreshable on request, showing when it was last read. It may optionally include pages linked from it on the same site, up to a stated number. | Planned |
| KNW-23 | Answers that use a website source must cite it as `notebook:<id>` and show its address. | Planned |
| KNW-24 | Website text is untrusted data like any document (OVR-6). | Planned |

Check: a test that a request to `http://192.168.1.1`, `http://localhost` or a redirect to them is refused; a demonstration of adding, citing and refreshing a page.

## Finding the right passage

| ID | Requirement | Status |
|---|---|---|
| KNW-30 | **On-device search.** A sentence-transformer running in the browser must match a question with curated Q&A and notebook passages by meaning, in any of the kiosk's 14 languages, with nothing sent anywhere. | Built |
| KNW-31 | Two models, selectable in Settings → Knowledge: *Multilingual MiniLM* (about 120 MB, 50 languages) and *LaBSE* (about 470 MB, 109 languages including Tamil, Telugu, Kannada, Malayalam and Bengali). *Automatic* picks by the kiosk language, and a question written in a script MiniLM wasn't trained on always uses LaBSE. | Built |
| KNW-32 | Each model must have calibrated thresholds for "answer word for word", "quote a notebook passage" and "pass to the agent", tested against real vectors so a change of model or threshold is caught. | Built |
| KNW-33 | The browser must pass what it found to the agent as references only; the server looks up the text itself, so a client cannot pass its own words off as the knowledge base. | Built |
| KNW-34 | The first use of a model must download it once, with progress shown, and must not hold up a question in the agent modes. | Built |

## Web fallback

| ID | Requirement | Status |
|---|---|---|
| KNW-40 | When the knowledge base and notebook don't cover a question, the kiosk must search the web automatically (if the organisation configured a search service and the visitor allows it), re-rank the results by meaning, and give the agent the best ones as `web:<n>` sources. | Built |
| KNW-41 | Coverage is decided from the browser's matches when it searched, otherwise from the server's sentence-transformer (bge-m3). When coverage can't be decided, web search is offered to the agent as a tool instead. | Built |
| KNW-42 | The organisation may restrict web search to a list of sites (for example official health sites). | Built |
| KNW-43 | The visitor must be able to switch web search off (Settings → Knowledge), and on-device mode never searches the web. | Built |
| KNW-44 | The question is sent to the search service, so the Settings text must say so, and possible emergencies are never searched (ANS-35). | Built |

## Tool routing

| ID | Requirement | Status |
|---|---|---|
| KNW-50 | When more than three optional tools are available (for example from MCP servers), only the tools that match the question by meaning (at most three) must be offered to the agent. The kiosk's own tools are always offered. | Built |
| KNW-51 | MCP servers come only from the organisation's configuration, never from a visitor, and their results are untrusted data. | Built |
