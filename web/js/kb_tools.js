// web/js/ollama_client.js
//
// Minimal streaming client for Ollama's /api/chat endpoint.
// Works with:
//  - http://localhost:11434/api/chat
//  - newline-delimited JSON streaming responses
//
// Exports:
//  - ollamaChatStream({ host, model, messages, onToken, options })
//
// Notes:
//  - `messages` format: [{ role: "system"|"user"|"assistant", content: "..." }, ...]
//  - `onToken(token)` is called as tokens stream in
//  - This function resolves when the stream ends (done=true)
//
// If you ever switch to Cloudflare/Vercel later, keep the same signature
// and implement a different backend client.

function joinUrl(host, path) {
  const h = String(host || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${h}/${p}`;
}

export async function ollamaChatStream({
  host = "http://localhost:11434",
  model,
  messages,
  onToken = () => {},
  options = {}
}) {
  if (!model) throw new Error("ollamaChatStream: 'model' is required");
  if (!Array.isArray(messages)) throw new Error("ollamaChatStream: 'messages' must be an array");

  const url = joinUrl(host, "/api/chat");

  // Reasonable defaults for an "incident assistant"
  const payload = {
    model,
    messages,
    stream: true,
    options: {
      temperature: 0.3,
      top_p: 0.9,
      num_predict: 256,
      ...options
    }
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error(
      `Ollama request failed. Is Ollama running? (${host})\n` + (err?.message || String(err))
    );
  }

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Ollama HTTP ${res.status}: ${text || res.statusText}`);
  }

  if (!res.body) {
    throw new Error("Ollama response has no body stream. (Browser/Fetch issue?)");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  // Ollama streams NDJSON: one JSON object per line
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        // If a partial line slips through, keep it in buffer
        buffer = trimmed + "\n" + buffer;
        continue;
      }

      // Common streaming shape:
      // { message: { role: "assistant", content: "..." }, done: false }
      const token = obj?.message?.content;
      if (typeof token === "string" && token.length) onToken(token);

      if (obj?.error) {
        throw new Error(`Ollama error: ${obj.error}`);
      }

      if (obj?.done) {
        return;
      }
    }
  }

  // Process any trailing buffered line
  const tail = buffer.trim();
  if (tail) {
    try {
      const obj = JSON.parse(tail);
      const token = obj?.message?.content;
      if (typeof token === "string" && token.length) onToken(token);
      if (obj?.error) throw new Error(`Ollama error: ${obj.error}`);
    } catch {
      // ignore
    }
  }
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
