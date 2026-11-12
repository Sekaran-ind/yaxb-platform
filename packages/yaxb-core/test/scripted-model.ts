// A fake chat model that replays a script: each model call takes the next step, which is either
// tool calls or a final text. Records what it was called with, for assertions. No network.
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";

export type Step = { text: string } | { calls: { name: string; args: Record<string, unknown> }[] };

export class ScriptedModel extends BaseChatModel {
  steps: Step[];
  calls: BaseMessage[][] = [];
  boundTools: string[][] = [];
  private cursor = 0;

  constructor(steps: Step[]) {
    super({});
    this.steps = steps;
  }

  _llmType() {
    return "scripted";
  }

  override bindTools(tools: unknown[]) {
    this.boundTools.push(tools.map((t) => (t as { name?: string }).name ?? "?"));
    return this as never;
  }

  private next(messages: BaseMessage[]): AIMessage {
    this.calls.push(messages);
    const step = this.steps[this.cursor++] ?? { text: "(script exhausted)" };
    if ("text" in step) return new AIMessage(step.text);
    return new AIMessage({
      content: "",
      tool_calls: step.calls.map((c, i) => ({ id: `call_${this.cursor}_${i}`, name: c.name, args: c.args, type: "tool_call" as const })),
    });
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.next(messages);
    return { generations: [{ text: typeof message.content === "string" ? message.content : "", message }] };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const message = this.next(messages);
    const text = typeof message.content === "string" ? message.content : "";
    if (message.tool_calls?.length) {
      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          tool_call_chunks: message.tool_calls.map((c, index) => ({
            id: c.id,
            name: c.name,
            args: JSON.stringify(c.args),
            index,
            type: "tool_call_chunk" as const,
          })),
        }),
      });
      return;
    }
    // Two chunks, to prove tokens stream.
    const half = Math.ceil(text.length / 2);
    for (const piece of [text.slice(0, half), text.slice(half)]) {
      if (!piece) continue;
      yield new ChatGenerationChunk({ text: piece, message: new AIMessageChunk({ content: piece }) });
      await runManager?.handleLLMNewToken(piece);
    }
  }
}
