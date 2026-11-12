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
| KNW-20 | A visitor (or moderator, for the knowledge base) must be able to add a website to a notebook by its address. The kiosk fetches the page, keeps its readable text (no scripts, navigation or ads), and stores it as a source with its title, address and the date it was read. | Built |
| KNW-21 | Pages must be fetched by the server, not the browser (browsers block most cross-site reads), with these limits: http(s) only; no private, local or link-local addresses (no requests to the kiosk's own network); at most 2 MB; at most 10 seconds; redirects re-checked against the same rules. | Built |
| KNW-22 | A website source must be refreshable on request, showing when it was last read. It may optionally include pages linked from it on the same site, up to a stated number. | Built |
| KNW-23 | Answers that use a website source must cite it as `notebook:<id>` and show its address. | Built |
| KNW-24 | Website text is untrusted data like any document (OVR-6). | Built |
| KNW-25 | Sites known for malware, phishing or adult content must be refused, with the reason ("blocked as unsafe"). Host names are resolved through a family-safe DNS resolver (Cloudflare 1.1.1.1 for Families), which answers 0.0.0.0 for them. | Built |
| KNW-26 | The organisation may limit website sources to a list of trusted sites (`WEBSITE_SOURCE_DOMAINS`; subdomains included), and block sites (`WEBSITE_BLOCKED_DOMAINS`). The Notebook screen shows the list when there is one. | Built |
| KNW-27 | When the organisation sets `SAFE_BROWSING_API_KEY`, every page address (each redirect too) must also be checked with Google Safe Browsing (malware, phishing, unwanted software); only the address is sent, and a page whose safety can't be checked is refused. | Built |
| KNW-28 | No automatic check can recognise every illegal or harmful site. Where only vetted sources are acceptable (a health kiosk for the public), the organisation should use the trusted-site list (KNW-26); moderators may block a site that slips through. | Built (guidance) |

Check: a test that a request to `http://192.168.1.1`, `http://localhost` or a redirect to them is refused; a demonstration of adding, citing and refreshing a page.

## Child safety (parked)

Layers on top of KNW-25..28, so that what a child can reach through the kiosk is age-appropriate. Agreed and deferred: build after the current roadmap.

| ID | Requirement | Status |
|---|---|---|
| CHS-1 | A fetched page's text must be classified before it is added as a source (a safety classifier such as Llama Guard on Workers AI), and refused with the category when it is flagged: child sexual exploitation, sexual content, violent crime, self-harm, weapons, hate. Only the text goes to the classifier. A page that can't be classified is refused while child safety is on. | Parked |
| CHS-2 | The organisation may set the DNS resolver used for website sources (`WEBSITE_DNS_RESOLVER`), so that a filtering resolver with wider categories (for example Cloudflare Gateway blocking child abuse, gambling, violence, drugs, weapons, hate and adult themes) replaces the family resolver of KNW-25. | Parked |
| CHS-3 | A page that declares itself adult (`<meta name="rating" content="adult">`, the RTA label) or sits behind an age gate must be refused. | Parked |
| CHS-4 | **Child mode**: while a profile with the age range "Under 18" is open, or when the kiosk is set to child mode, websites may be added only from the trusted-site list (KNW-26); with no list, adding websites is off. | Parked |
| CHS-5 | In child mode the web fallback (KNW-40) must use strict safe search, or be off when the configured search provider has no safe search. The assistant's instructions add a rule to keep answers age-appropriate. | Parked |
| CHS-6 | Web search results (KNW-40) must pass the same address checks (KNW-25..27) and content check (CHS-1) as website sources before the assistant sees them. | Parked |
| CHS-7 | Visitors must be able to report a notebook source or a web-sourced answer ("Report this source"). The report reaches the moderation queue with the address only. A moderator may block the site at once; the blocklist is then kept on the server (with `WEBSITE_BLOCKED_DOMAINS` still applying), and every block is in the audit log (MOD-25). | Parked |
| CHS-8 | Refused and blocked attempts must be counted for moderators (address and category only, never page text), so repeated attempts show. | Parked |
| CHS-9 | The organisation must have a written child-safety policy, named people who handle reports, and the national route for reporting illegal content involving children (in India the National Cybercrime Reporting Portal, cybercrime.gov.in; elsewhere NCMEC or the IWF). Moderators must never re-share reported material. | Parked (organisation) |

Check: tests with classifier and resolver fakes that flagged pages, adult-rated pages and non-listed sites in child mode are refused; a demonstration of a report reaching the queue and a moderator's block taking effect.

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
| KNW-45 | **Kiosk only (no AI model)**: a question the knowledge base and notebook don't cover gets the top web results (up to 3, ranked by meaning when the server sentence-transformer is available), each quoted as the search returned it with its address, under a line saying they are not checked by the kiosk's moderators. Nothing is generated or rewritten. Not when web search is off, not configured, or the question may be an emergency. | Built |
| KNW-44 | The question is sent to the search service, so the Settings text must say so, and possible emergencies are never searched (ANS-35). | Built |

## Tool routing

| ID | Requirement | Status |
|---|---|---|
| KNW-50 | When more than three optional tools are available (for example from MCP servers), only the tools that match the question by meaning (at most three) must be offered to the agent. The kiosk's own tools are always offered. | Built |
| KNW-51 | MCP servers come only from the organisation's configuration, never from a visitor, and their results are untrusted data. | Built |
