/**
 * One call to Claude that must answer by filling in a single tool. Server only.
 * The tool's input is returned as-is: callers must check it before using it.
 */
export async function callClaudeTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: object };
  maxTokens: number;
  timeoutMs?: number;
}): Promise<{ input: T | undefined; usage?: { input_tokens?: number; output_tokens?: number } }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("AI isn't set up on this server.");
  const base = (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/$/, "");
  const send = async (toolChoice: object) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
    try {
      return await fetch(`${base}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens,
          // The fixed instructions are cached, so repeat calls only pay for the file sample.
          system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
          tools: [opts.tool],
          tool_choice: toolChoice,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
    } catch (issue) {
      throw new Error(issue instanceof Error && issue.name === "AbortError" ? "The AI took too long. Please try again." : "Couldn't reach the AI. Please try again.");
    } finally {
      clearTimeout(timer);
    }
  };
  const readError = async (r: Response) => {
    const text = await r.text().catch(() => "");
    let message = text;
    try { message = (JSON.parse(text) as { error?: { message?: string } }).error?.message || text; } catch { /* plain text */ }
    return message.slice(0, 500);
  };

  let response = await send({ type: "tool", name: opts.tool.name });
  let errorText = response.ok ? "" : await readError(response);
  // Some models refuse a forced tool (e.g. when they think first): ask again, letting it choose.
  if (!response.ok && response.status === 400 && /tool_choice|thinking/i.test(errorText)) {
    response = await send({ type: "auto" });
    errorText = response.ok ? "" : await readError(response);
  }
  if (!response.ok) {
    console.error("[ai] error", response.status, opts.model, errorText);
    if (response.status === 401 || response.status === 403) throw new Error("Smart import isn't set up properly (AI key). Ask us to import it for you.");
    if (/credit balance|billing|quota/i.test(errorText)) throw new Error("Smart import is paused right now. Ask us to import it for you.");
    if (response.status === 404 || /model/i.test(errorText)) throw new Error("Smart import isn't set up properly (AI model). Ask us to import it for you.");
    if (response.status === 429 || response.status === 529) throw new Error("The AI is busy right now. Please try again in a minute.");
    throw new Error(`The AI couldn't help just now (error ${response.status}). Please try again.`);
  }
  const data = (await response.json()) as { content?: Array<{ type: string; name?: string; input?: T }>; usage?: { input_tokens?: number; output_tokens?: number } };
  return { input: data.content?.find((c) => c.type === "tool_use" && c.name === opts.tool.name)?.input, usage: data.usage };
}
