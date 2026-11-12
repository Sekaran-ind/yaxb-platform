/** In-browser model catalog for the Sandbox tab (ported from loadmodels/Models.json, text tasks). */
export type SandboxModel = {
  id: string;
  label: string;
  pipelineTask: string;
  model: string;
  input: "text" | "qa" | "zero-shot";
  output: "text" | "labels" | "tokens" | "json";
  sample: { text: string; question?: string; labels?: string };
  prefix?: string;
  params?: Record<string, unknown>;
};

export type SandboxRequest = { id: string; text: string; question?: string; labels?: string };

export const SANDBOX_MODELS: SandboxModel[] = [
  {
    id: "text-generation",
    label: "Text generation w/ distilgpt2 (85 MB)",
    pipelineTask: "text-generation",
    model: "Xenova/distilgpt2",
    input: "text",
    output: "text",
    sample: { text: "I enjoy walking with my cute dog," },
    params: { max_new_tokens: 100, temperature: 1, top_k: 20, do_sample: true },
  },
  {
    id: "translation",
    label: "Translation w/ t5-small (78 MB)",
    pipelineTask: "translation",
    model: "Xenova/t5-small",
    input: "text",
    output: "text",
    prefix: "translate English to French: ",
    sample: { text: "Hello, how are you?" },
    params: { max_new_tokens: 50 },
  },
  {
    id: "fill-mask",
    label: "Masked language modelling w/ bert-base-cased (110 MB)",
    pipelineTask: "fill-mask",
    model: "Xenova/bert-base-cased",
    input: "text",
    output: "labels",
    sample: { text: "The goal of life is [MASK]." },
    params: { top_k: 5 },
  },
  {
    id: "text-classification",
    label: "Text classification w/ bert-base-multilingual-uncased-sentiment (169 MB)",
    pipelineTask: "text-classification",
    model: "Xenova/bert-base-multilingual-uncased-sentiment",
    input: "text",
    output: "labels",
    sample: { text: "The care team was wonderful and very attentive." },
    params: { top_k: 5 },
  },
  {
    id: "token-classification",
    label: "Token classification w/ bert-base-multilingual-cased-ner-hrl (178 MB)",
    pipelineTask: "token-classification",
    model: "Xenova/bert-base-multilingual-cased-ner-hrl",
    input: "text",
    output: "tokens",
    sample: { text: "Elizabeth works at Yaxb in Bengaluru." },
  },
  {
    id: "zero-shot-classification",
    label: "Zero-shot classification w/ distilbert-base-uncased-mnli (68 MB)",
    pipelineTask: "zero-shot-classification",
    model: "Xenova/distilbert-base-uncased-mnli",
    input: "zero-shot",
    output: "json",
    sample: { text: "I have a headache and a mild fever.", labels: "symptoms, billing, appointments" },
    params: { multi_label: false },
  },
  {
    id: "question-answering",
    label: "Question answering w/ distilbert-base-cased-distilled-squad (66 MB)",
    pipelineTask: "question-answering",
    model: "Xenova/distilbert-base-cased-distilled-squad",
    input: "qa",
    output: "json",
    sample: {
      question: "What is the catheter's size?",
      text: "The Aintree Intubation Catheter (AIC) is a 19 French, blunt-tipped, radiopaque catheter with centimeter markings.",
    },
  },
  {
    id: "summarization",
    label: "Summarization w/ distilbart-cnn-6-6 (284 MB)",
    pipelineTask: "summarization",
    model: "Xenova/distilbart-cnn-6-6",
    input: "text",
    output: "text",
    sample: {
      text: "Electronic health records hold a patient's medical history, including diagnoses, medications and treatment plans. They let clinicians across departments see the same up-to-date information, reducing duplicate tests and medication errors.",
    },
    params: { max_new_tokens: 50, num_beams: 2 },
  },
  {
    id: "code-completion",
    label: "Code completion w/ codegen-350M-mono (369 MB)",
    pipelineTask: "text-generation",
    model: "Xenova/codegen-350M-mono",
    input: "text",
    output: "text",
    sample: { text: "def fib(n):" },
    params: { max_new_tokens: 50 },
  },
];
