// web/js/ollama_client.js
//
// Robust streaming + non-streaming client for Ollama (or a local proxy).
// Supports:
//  - Native Ollama /api/chat NDJSON streaming
//  - /api/generate-style streaming frames (response field)
//  - SSE (text/event-stream) where each line is "data: {...}"
//  - Single JSON responses (non-NDJSON), including OpenAI-like shapes
//  - NEW: brace-balanced JSON extraction when proxies remove NDJSON newlines
//
// Exports:
//  - ollamaChatStream({ host, model, messages, onToken, onMeta, options, request, debug })
//  - ollamaChatOnce({ host, model, messages, options, request, debug })
//
// Notes:
//  - `messages`: [{ role: "system"|"user"|"assistant", content: "..." }, ...]
//  - Streaming calls `onToken(token, meta)`
//  - Always emits a final `onToken("", {done:true,...})` when the request finishes.

function joinUrl(host, path) {
  const h = String(host || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  return `${h}/${p}`;
}

function isAbortError(err) {
  return (
    err?.name === "AbortError" ||
    err?.code === "ABORT_ERR" ||
    String(err?.message || "").toLowerCase().includes("aborted")
  );
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function normalizeHost(host) {
  // Prefer 127.0.0.1 to avoid some localhost resolution edge-cases.
  const h = String(host || "http://127.0.0.1:11434");
  return h.includes("localhost:11434") ? h.replace("localhost:11434", "127.0.0.1:11434") : h;
}

export async function ollamaChatOnce({
  host = "http://127.0.0.1:11434",
  model,
  messages,
  options = {},
  request = {},
  debug = false
} = {}) {
  if (!model) throw new Error("ollamaChatOnce: 'model' is required");
  if (!Array.isArray(messages)) throw new Error("ollamaChatOnce: 'messages' must be an array");

  const safeHost = normalizeHost(host);
  const url = joinUrl(safeHost, "/api/chat");
  const payload = buildPayload({ model, messages, stream: false, options, request });

  const { res } = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal: request.signal,
    timeoutMs: request.timeoutMs,
    debug
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Ollama HTTP ${res.status}: ${text || res.statusText}`);
  }

  const text = await safeReadText(res);
  const json = safeParseJson(text);

  if (json?.error) throw new Error(`Ollama error: ${json.error}`);

  const content = extractTokenFromAnyShape(json) || (typeof text === "string" ? text : "");
  return typeof content === "string" ? content : "";
}

/**
 * Extract complete JSON objects from a stream buffer even when
 * NDJSON newlines are missing (proxy buffering / concatenation).
 *
 * This scans for balanced {...} objects while respecting strings and escapes.
 * Returns { frames: string[], rest: string } where frames are JSON strings.
 */
function extractJsonObjectsFromBuffer(buffer) {
  const frames = [];
  let i = 0;

  // Skip any leading whitespace
  while (i < buffer.length && /\s/.test(buffer[i])) i++;

  // We might have non-JSON leading lines (SSE "data:" etc.). We only do brace-mode
  // when we see an object start.
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (; i < buffer.length; i++) {
    const ch = buffer[i];

    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    // We are inside a JSON object scan
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        continue;
      }
      continue;
    } else {
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;

      if (depth === 0) {
        const jsonStr = buffer.slice(start, i + 1);
        frames.push(jsonStr);

        // Reset and continue scanning after this object
        start = -1;

        // Skip whitespace after object
        let j = i + 1;
        while (j < buffer.length && /\s/.test(buffer[j])) j++;
        i = j - 1;
      }
    }
  }

  // If we were mid-object, keep the remainder from start; else keep remainder from last consumed point.
  if (start !== -1) {
    return { frames, rest: buffer.slice(start) };
  }

  // No partial object pending. Keep trailing non-object junk (usually empty/whitespace).
  return { frames, rest: "" };
}

export async function ollamaChatStream({
  host = "http://127.0.0.1:11434",
  model,
  messages,
  onToken = () => {},
  onMeta = null,
  options = {},
  request = {},
  debug = false
} = {}) {
  if (!model) throw new Error("ollamaChatStream: 'model' is required");
  if (!Array.isArray(messages)) throw new Error("ollamaChatStream: 'messages' must be an array");

  const safeHost = normalizeHost(host);
  const url = joinUrl(safeHost, "/api/chat");
  const payload = buildPayload({ model, messages, stream: true, options, request });

  const { res, controller } = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Encourage streaming content-types from proxies
      Accept: "application/x-ndjson, text/event-stream, application/json"
    },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal: request.signal,
    timeoutMs: request.timeoutMs,
    debug
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Ollama HTTP ${res.status}: ${text || res.statusText}`);
  }

  if (!res.body) {
    // Some environments/proxies buffer and remove streaming. Fall back to res.text().
    const text = await safeReadText(res);
    const json = safeParseJson(text);
    if (json?.error) throw new Error(`Ollama error: ${json.error}`);

    const content = extractTokenFromAnyShape(json) || text || "";
    if (content) {
      try {
        onToken(String(content), { buffered: true });
      } catch {
        // ignore
      }
    }
    try {
      onToken("", { done: true, buffered: true });
    } catch {
      // ignore
    }
    return String(content || "");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const isSse = contentType.includes("text/event-stream");

  if (debug) {
    // eslint-disable-next-line no-console
    console.log("[ollama_client] response content-type:", contentType || "(none)");
  }

  let buffer = "";
  let full = "";
  let sawDone = false;

  const emitMeta = (obj) => {
    if (typeof onMeta === "function") {
      try {
        onMeta(obj);
      } catch {
        // ignore
      }
    }
  };

  const emitToken = (tok, meta) => {
    if (typeof tok === "string" && tok.length) {
      full += tok;
      try {
        onToken(tok, meta);
      } catch {
        // ignore
      }
    }
  };

  const emitDone = (meta = {}) => {
    try {
      onToken("", { done: true, ...meta });
    } catch {
      // ignore
    }
  };

  const handleFrameObject = (obj) => {
    if (!obj) return "CONTINUE";

    emitMeta(obj);

    if (obj?.error) {
      throw new Error(`Ollama error: ${obj.error}`);
    }

    const tok = extractTokenFromAnyShape(obj);
    if (tok) emitToken(tok, obj);

    // done flags appear in different shapes
    if (obj?.done === true || obj?.finish_reason || obj?.choices?.[0]?.finish_reason) {
      sawDone = true;
      emitDone(obj);
      return "DONE";
    }
    return "CONTINUE";
  };

  const handleLine = (line) => {
    let trimmed = String(line || "").trim();
    if (!trimmed) return "CONTINUE";

    // SSE: lines are "data: {...}" or "data: [DONE]"
    if (trimmed.startsWith("data:")) {
      trimmed = trimmed.slice(5).trim();
      if (!trimmed) return "CONTINUE";
      if (trimmed === "[DONE]") {
        sawDone = true;
        emitDone({ sse: true, done: true });
        return "DONE";
      }
    }

    // Some proxies emit keepalive pings
    if (trimmed === ":" || trimmed.toLowerCase() === "ping") return "CONTINUE";

    const obj = safeParseJson(trimmed);
    if (obj) return handleFrameObject(obj);

    // If it's not JSON, treat it as raw text streaming (rare but happens with proxies)
    emitToken(trimmed, { rawText: true });
    return "CONTINUE";
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 1) If SSE, keep the existing line-based parsing (it’s correct).
      if (isSse) {
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const status = handleLine(line.replace(/\r$/, ""));
          if (status === "DONE") return full;
        }
        continue;
      }

      // 2) For NDJSON, try normal newline splits FIRST.
      // If we get no parseable lines for a while (because newlines are missing),
      // brace-balanced extraction will still pull complete objects out.
      const lines = buffer.split("\n");
      const tail = lines.pop() || "";

      let progressed = false;

      for (const line of lines) {
        const trimmed = String(line || "").trim();
        if (!trimmed) continue;

        const obj = safeParseJson(trimmed);
        if (obj) {
          progressed = true;
          const status = handleFrameObject(obj);
          if (status === "DONE") return full;
        } else {
          // Non-JSON line in non-SSE mode: treat as raw text
          progressed = true;
          emitToken(trimmed, { rawText: true });
        }
      }

      buffer = tail;

      // 3) If NDJSON newlines are missing, try brace-balanced extraction.
      // We only do this if buffer is getting sizable OR if we didn’t parse anything.
      if (!progressed || buffer.length > 8_192) {
        const { frames, rest } = extractJsonObjectsFromBuffer(buffer);
        if (frames.length) {
          for (const jsonStr of frames) {
            const obj = safeParseJson(jsonStr);
            if (obj) {
              const status = handleFrameObject(obj);
              if (status === "DONE") return full;
            }
          }
        }
        buffer = rest;
      }
    }

    // Flush tail
    const tail = buffer.trim();
    if (tail) {
      if (isSse) {
        const tailLines = tail.split("\n");
        for (const l of tailLines) {
          const status = handleLine(l.replace(/\r$/, ""));
          if (status === "DONE") return full;
        }
      } else {
        // Try parse as single JSON
        const obj = safeParseJson(tail);
        if (obj) {
          const status = handleFrameObject(obj);
          if (status === "DONE") return full;
        } else {
          // Try brace extraction on final tail
          const { frames } = extractJsonObjectsFromBuffer(tail);
          for (const jsonStr of frames) {
            const o = safeParseJson(jsonStr);
            if (o) {
              const status = handleFrameObject(o);
              if (status === "DONE") return full;
            }
          }
        }
      }
    }

    // If transport ends without done:true, still finalize so UI doesn’t hang
    if (!sawDone) {
      emitDone({ transportClosed: true, sse: isSse });
    }

    return full;
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error("Ollama request aborted.");
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    if (controller && !request.signal) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }
  }
}

function buildPayload({ model, messages, stream, options, request }) {
  const temperature = typeof options.temperature === "number" ? options.temperature : 0.3;
  const top_p = typeof options.top_p === "number" ? options.top_p : 0.9;
  const num_predict = clampInt(options.num_predict, 16, 2048, 256);

  const payload = {
    model,
    messages,
    stream: Boolean(stream),
    options: {
      temperature,
      top_p,
      num_predict,
      ...options
    }
  };

  if (request && typeof request.format !== "undefined") {
    payload.format = request.format;
  }

  if (request && typeof request.keep_alive !== "undefined") {
    payload.keep_alive = request.keep_alive;
  }

  return payload;
}

function extractTokenFromAnyShape(obj) {
  if (!obj || typeof obj !== "object") return "";

  // Native Ollama /api/chat streaming
  if (typeof obj?.message?.content === "string" && obj.message.content.length) {
    return obj.message.content;
  }

  // Ollama /api/generate streaming shape
  if (typeof obj?.response === "string" && obj.response.length) {
    return obj.response;
  }

  // Some proxies use these
  if (typeof obj?.content === "string" && obj.content.length) return obj.content;
  if (typeof obj?.text === "string" && obj.text.length) return obj.text;
  if (typeof obj?.output === "string" && obj.output.length) return obj.output;

  // OpenAI-ish
  const delta = obj?.choices?.[0]?.delta?.content;
  if (typeof delta === "string" && delta.length) return delta;

  const msg = obj?.choices?.[0]?.message?.content;
  if (typeof msg === "string" && msg.length) return msg;

  // If a full final object arrives in one shot
  const final = obj?.final?.content || obj?.result?.content;
  if (typeof final === "string" && final.length) return final;

  return "";
}

function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, { timeoutMs, signal, debug, ...init } = {}) {
  const t = clampInt(timeoutMs, 1000, 10 * 60 * 1000, 120000);
  let controller = null;
  let timeoutId = null;

  if (!signal) {
    controller = new AbortController();
    init.signal = controller.signal;
    timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, t);
  } else {
    init.signal = signal;
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log("[ollama_client] POST", url, { timeoutMs: t, hasExternalSignal: !!signal });
  }

  try {
    const res = await fetch(url, init);
    return { res, controller };
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error("Ollama request timed out or was aborted.");
    }
    throw new Error(
      `Ollama request failed. Is Ollama running? (${url})\n` + (err?.message || String(err))
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
