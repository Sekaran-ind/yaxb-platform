// What the footer, the contact panel and the legal page (/terms-conditions) say, in one place (after
// ClinüxFlow's src/legal/legal.js). Everything here must match what the kiosk actually does
// (docs/specs/09-privacy-storage-security.md); only what Anjal really uses is credited, and a service
// or library we use is not an endorsement. Update this file, and UPDATED, when that changes.

export const BRAND = "Anjalai";
export const UPDATED = "2026-11-14";
export const CONTACT_EMAIL = "helpdesk@yaxb.ai";
export const CLINUX_URL = "https://clinux.yaxb.ai/";
export const OPERATOR = {
  name: "Yaxb Technology Solutions Private Limited",
  gstin: "33AABCY8630L1Z1",
  registered: "1st Floor, 6/4, Subramaniyapuram, Mohanur, Namakkal, Tamil Nadu 637015",
};

export interface Credit {
  name: string;
  detail: string;
  url?: string;
}

export const CREDITS: { intro: string; groups: { title: string; items: Credit[] }[] } = {
  intro: "Anjal uses these services, models and open-source projects. Being listed here does not mean they endorse Anjal.",
  groups: [
    {
      title: "Services the kiosk may call",
      items: [
        { name: "AI model providers", detail: "Anthropic, OpenAI, Google, or a model the organisation runs itself (such as Ollama). Only the provider chosen in Preferences → Model receives a question, with that turn's notebook text." },
        { name: "Cloudflare", detail: "Hosts the kiosk (Workers), keeps server-side data in D1, and computes server embeddings with Workers AI (BAAI bge-m3).", url: "https://www.cloudflare.com/" },
        { name: "Web search", detail: "Tavily or Brave Search, only when the organisation has turned web search on and nothing in the kiosk's knowledge covers a question." },
        { name: "Website safety", detail: "Cloudflare's family DNS resolver (family.cloudflare-dns.com) and, when configured, Google Safe Browsing check every website before it is read into a notebook." },
      ],
    },
    {
      title: "Models that run on your device",
      items: [
        { name: "paraphrase-multilingual-MiniLM-L12-v2 and LaBSE", detail: "Sentence-transformers for finding the right passage, in 50+ languages. Apache-2.0.", url: "https://www.sbert.net/" },
        { name: "NLLB-200 (distilled, 600M)", detail: "Meta's translation model, for on-device answers in your language. CC-BY-NC-4.0.", url: "https://huggingface.co/facebook/nllb-200-distilled-600M" },
        { name: "bert-base-multilingual-cased-ner-hrl", detail: "Recognises names, places and organisations when a form fills itself from what you say." },
        { name: "Transformers.js", detail: "Runs these models in the browser. Apache-2.0.", url: "https://huggingface.co/docs/transformers.js" },
      ],
    },
    {
      title: "Built with",
      items: [
        { name: "LangGraph and Deep Agents", detail: "LangChain, MIT. Run the kiosk's agent and the Service Designer.", url: "https://github.com/langchain-ai/langgraphjs" },
        { name: "Vue and Tailwind CSS", detail: "The web app. MIT.", url: "https://vuejs.org/" },
        { name: "Hono", detail: "The kiosk's server on Cloudflare Workers. MIT.", url: "https://hono.dev/" },
        { name: "PDF.js", detail: "Reads PDFs in the browser. Apache-2.0.", url: "https://mozilla.github.io/pdf.js/" },
        { name: "CodeMirror", detail: "The Service Catalogue's YAML editor. MIT.", url: "https://codemirror.net/" },
        { name: "Capacitor", detail: "The Android and iOS app. MIT.", url: "https://capacitorjs.com/" },
        { name: "Lucide", detail: "Icons. ISC.", url: "https://lucide.dev/" },
      ],
    },
  ],
};
