---
name: summarise-document
description: Summarise one notebook source or a long passage for a visitor, at the length they ask for. Use when asked to summarise, give the gist, or list key points of a document.
---

# Summarise a document

- Find the source in `/notebook/README.md` and read it with `read_file` (in parts if it's long).
- Default shape, unless the visitor asks otherwise:
  1. One sentence saying what the document is and who it's for.
  2. Three to six key points, each one short sentence.
  3. Anything the reader must act on: dates, deadlines, warnings, who to contact.
- Keep numbers, names and dates exactly as written. Don't add facts the document doesn't contain.
- Replies are read aloud: no tables, and say "point one", "point two" only if the visitor asked for a list.
- End with the citation, for example (sources: notebook:abc123).
