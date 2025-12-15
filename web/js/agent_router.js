// web/js/agent_router.js
//
// ApexGrid Incident Assistant — Agent Router
// -----------------------------------------
// Purpose:
// - Provide a single, stable interface for the UI:
//      agent.respond(userText, onToken)
// - Route to different backends (Local Ollama now; Browser llama.cpp later)
// - Optionally inject local KB context (facts/runbooks) into the prompt
// - Track conversation history (messages[]) in an OpenAI/Ollama-style format
//
// Expected DOM (from assistant_card.html):
// - root: [data-assistant-card]
// - mode buttons: [data-ai-mode="ollama"], [data-ai-mode="browser"]
// - input: [data-ai-input]
// - send: [data-ai-send]
// - transcript: [data-ai-transcript], [data-ai-messages]
// - clear: [data-ai-clear]
// - suggest buttons: [data-ai-suggest]
// - status: [data-ai-status-text], [data-ai-status-dot]
// - sources: [data-ai-sources]
// - include sources checkbox: [data-ai-include-sources]
//
// Dependencies:
// - web/js/ollama_client.js must export: ollamaChatStream({ host, model, messages, onToken, onMeta })
//
// Notes:
// - Local KB uses manifest + facts JSON files under /web/assets
//   (wired here with fetch + naive search). You can later replace this with
//   embeddings + vector search without changing the UI contract.

import { ollamaChatStream } from "./ollama_client.js";

const DEFAULTS = {
  ollamaModel: "qwen3:latest",
  ollamaHost: "http://localhost:11434",
  maxKbSnippets: 6,
  maxKbChars: 1400,
  systemPrompt: [
    "You are the ApexGrid Incident Assistant.",
    "You help SREs and infra leads triage incidents across ApexGrid products (GridSense, VaultShield, LineaOps, HelioCloud).",
    "Be concise, actionable, and technically grounded. Prefer checklists and concrete next steps.",
    "If you use local product knowledge snippets, cite them as [KB:ProductName • SnippetTitle].",
    "If information is missing, ask 1-2 clarifying questions.",
    // Force explicit tags to make parsing reliable
    "IMPORTANT: If you need to think before answering, you MUST start your response with <think> and end the thought with </think>.",
    "Do not output internal reasoning without these tags."
  ].join(" ")
};

// --------------------
// DEBUG SETTINGS
// --------------------
const DEBUG_AGENT = true;

// Clean logs: set these to false to stop the spam
const DEBUG_LOG_FRAMES = false;
const DEBUG_LOG_TOKENS = false;

// Limit how much content we print when logging candidates
const DEBUG_CONTENT_PREVIEW_CHARS = 260;

function $(root, sel) {
  return root.querySelector(sel);
}

function $all(root, sel) {
  return Array.from(root.querySelectorAll(sel));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nowIso() {
  return new Date().toISOString();
}

function preview(s, n = DEBUG_CONTENT_PREVIEW_CHARS) {
  const str = String(s ?? "");
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function safeKeys(obj) {
  try {
    return Object.keys(obj || {});
  } catch {
    return [];
  }
}

/**
 * Gather string-ish fields for debugging without dumping everything.
 * Returns an array of { path, preview } entries for any string fields found.
 */
function gatherStringFields(obj, { prefix = "", maxDepth = 2 } = {}) {
  const out = [];
  const seen = new Set();

  function walk(o, p, depth) {
    if (!o || typeof o !== "object") return;
    if (seen.has(o)) return;
    seen.add(o);

    if (depth > maxDepth) return;

    for (const k of Object.keys(o)) {
      const v = o[k];
      const path = p ? `${p}.${k}` : k;

      if (typeof v === "string" && v.length) {
        out.push({ path: prefix ? `${prefix}.${path}` : path, preview: preview(v) });
      } else if (Array.isArray(v)) {
        if (v.length && depth < maxDepth) {
          for (let i = 0; i < Math.min(v.length, 3); i++) {
            const item = v[i];
            if (typeof item === "string" && item.length) {
              out.push({
                path: prefix ? `${prefix}.${path}[${i}]` : `${path}[${i}]`,
                preview: preview(item)
              });
            } else if (item && typeof item === "object") {
              walk(item, `${path}[${i}]`, depth + 1);
            }
          }
        }
      } else if (v && typeof v === "object") {
        walk(v, path, depth + 1);
      }
    }
  }

  walk(obj, "", 0);
  return out;
}

// ----------------------------
// Heuristic candidate discovery
// ----------------------------

function normalizeWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function looksLikeRoleString(s) {
  const t = normalizeWhitespace(s).toLowerCase();
  return t === "assistant" || t === "user" || t === "system" || t === "tool" || t === "developer";
}

function looksLikeLowEntropyJunk(s) {
  const t = normalizeWhitespace(s);
  if (!t) return true;

  // Reject pure role spam
  const lower = t.toLowerCase();
  if (/^(assistant\s*){3,}$/i.test(lower)) return true;

  const words = lower.split(" ").filter(Boolean);
  if (words.length >= 6) {
    const freq = new Map();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    const max = Math.max(...freq.values());
    const ratio = max / words.length;

    // If the same token dominates the string, it’s almost certainly not real output.
    if (ratio >= 0.65) return true;
  }

  // FIX: Removed length check to allow small tokens like "I", "a", ","
  return false;
}

function isProbablyMetaString(path, value) {
  const p = String(path || "").toLowerCase();
  const v = String(value || "");

  // hard exclude common non-text fields
  if (
    p.endsWith(".role") ||
    p.includes(".role") ||
    p.endsWith(".type") ||
    p.includes(".type") ||
    p.endsWith(".format") ||
    p.includes(".format")
  ) {
    return true;
  }

  // obvious metadata fields
  if (
    p.includes("model") ||
    p.includes("created_at") ||
    p.includes("done_reason") ||
    p.includes("total_duration") ||
    p.includes("load_duration") ||
    p.includes("prompt_eval") ||
    p.includes("eval_count") ||
    p.includes("eval_duration") ||
    p.includes("context") ||
    p.includes("id")
  ) {
    return true;
  }

  // ISO timestamps / short identifiers
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i.test(v)) return true;
  if (looksLikeRoleString(v)) return true;

  // Low-entropy junk / spam strings
  if (looksLikeLowEntropyJunk(v)) return true;

  return false;
}

/**
 * Heuristic: find the "most likely" assistant text field inside a frame.
 * Returns { text, path } or { text:"", path:"" }.
 */
function findBestTextCandidate(frame) {
  const fields = gatherStringFields(frame, { prefix: "frame", maxDepth: 5 });
  if (!fields.length) return { text: "", path: "" };

  const scored = fields
    .map(({ path }) => {
      let score = 0;
      const p = path.toLowerCase();

      // strong positives
      if (p.includes("message.content")) score += 80;
      if (p.includes("choices[0].delta.content")) score += 80;
      if (p.includes(".delta.content")) score += 70;

      // common positives
      if (p.includes("content")) score += 24;
      if (p.includes("response")) score += 22;
      if (p.includes("output")) score += 20;
      if (p.includes("text")) score += 18;
      if (p.includes("delta")) score += 14;

      // negatives: role/type/meta-like paths
      if (p.includes(".role") || p.endsWith(".role")) score -= 120;
      if (p.includes(".type") || p.endsWith(".type")) score -= 80;
      if (
        p.includes("model") ||
        p.includes("created_at") ||
        p.includes("done_reason") ||
        p.includes("duration") ||
        p.includes("count") ||
        p.includes("eval") ||
        p.includes("context")
      ) {
        score -= 40;
      }

      return { path, score };
    })
    .sort((a, b) => b.score - a.score);

  function getByPath(obj, dottedPath) {
    try {
      let p = dottedPath;
      if (p.startsWith("frame.")) p = p.slice("frame.".length);

      const tokens = p
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);

      let cur = obj;
      for (const t of tokens) {
        if (cur == null) return undefined;
        cur = cur[t];
      }
      return cur;
    } catch {
      return undefined;
    }
  }

  let best = { text: "", path: "", score: -Infinity, len: 0 };

  for (const cand of scored.slice(0, 18)) {
    const val = getByPath(frame, cand.path);
    if (typeof val !== "string") continue; 

    if (isProbablyMetaString(cand.path, val)) continue;

    const trimmed = normalizeWhitespace(val);
    
    // special case: allow single spaces to pass through (cumulative logic sometimes needs this)
    if (!trimmed && val.length === 0) continue;

    const hasSpace = trimmed.includes(" ");
    const hasPunct = /[.!?:;\n]/.test(trimmed);
    const structureBonus = (hasSpace ? 4 : 0) + (hasPunct ? 4 : 0);

    const total = cand.score + structureBonus + Math.min(60, trimmed.length / 18);
    
    // Save raw 'val' to preserve spaces/newlines
    if (total > best.score || (total === best.score && val.length > best.len)) {
      best = { text: val, path: cand.path, score: total, len: val.length };
    }
  }

  return { text: best.text || "", path: best.path || "" };
}

/**
 * Stream-safe: convert a per-frame candidate into an incremental delta.
 */
function computeDeltaFromCandidate(candidateText, prevText) {
  const cur = String(candidateText || "");
  const prev = String(prevText || "");

  if (!cur) return { delta: "", nextPrev: prev };

  if (prev && cur.startsWith(prev)) {
    return { delta: cur.slice(prev.length), nextPrev: cur };
  }

  if (cur.length <= 64) {
    return { delta: cur, nextPrev: prev + cur };
  }

  return { delta: cur, nextPrev: cur };
}

function extractTextFromFrame(frame) {
  if (!frame || typeof frame !== "object") return "";

  const msg = frame.message;
  const mc = msg?.content;

  if (typeof mc === "string" && mc.length) return mc;
  if (typeof frame.response === "string" && frame.response.length) return frame.response;

  // Filter explicit reasoning fields if present
  if (typeof msg?.thinking === "string") return ""; 
  if (typeof msg?.reasoning === "string") return "";
  
  if (mc && typeof mc === "object") {
    if (typeof mc.text === "string" && mc.text.length) return mc.text;
    if (Array.isArray(mc) && mc.length) {
      const firstText = mc.find((x) => x && typeof x.text === "string" && x.text.length);
      if (firstText) return firstText.text;
    }
  }

  const delta = frame?.choices?.[0]?.delta;
  if (typeof delta?.content === "string" && delta.content.length) return delta.content;

  if (typeof frame.content === "string" && frame.content.length) return frame.content;
  if (typeof frame.output === "string" && frame.output.length) return frame.output;
  if (typeof msg === "string" && msg.length) return msg;

  return "";
}

function extractFinalTextFromFrame(frame) {
  const normal = extractTextFromFrame(frame);
  if (normal && !looksLikeLowEntropyJunk(normal)) return normal;

  const { text } = findBestTextCandidate(frame);
  if (text && !looksLikeLowEntropyJunk(text)) return text;

  return "";
}

class LocalKb {
  constructor({ baseUrl = "./assets" } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.ready = false;
    this.products = [];
    this.docs = [];
  }

  async init() {
    if (this.ready) return;

    const manifestUrl = `${this.baseUrl}/manifest.json`;
    try {
      const manifest = await fetchJson(manifestUrl);
      const products = Array.isArray(manifest?.products) ? manifest.products : [];
      this.products = products;

      const factsList = await Promise.all(
        products.map(async (p) => {
          const url = `${this.baseUrl}/${p}_facts.json`;
          try {
            return await fetchJson(url);
          } catch {
            return null;
          }
        })
      );

      this.docs = normalizeFactsToSnippets(factsList.filter(Boolean));
      this.ready = true;
    } catch {
      this.products = [];
      this.docs = [];
      this.ready = true;
    }
  }

  listProducts() {
    return [...this.products];
  }

  search(query, { maxSnippets = DEFAULTS.maxKbSnippets } = {}) {
    const q = (query || "").trim().toLowerCase();
    if (!q || this.docs.length === 0) return { snippets: [], joinedText: "" };

    const qTerms = q
      .split(/[\s,.;:!?()\[\]{}"']+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);

    const scored = this.docs
      .map((d) => {
        const hay = (d.title + " " + d.text + " " + d.product).toLowerCase();
        let score = 0;

        for (const term of qTerms) {
          if (!term) continue;
          const idx = hay.indexOf(term);
          if (idx !== -1) {
            score += 2;
            if ((d.title || "").toLowerCase().includes(term)) score += 2;
          }
        }

        if (q.includes(d.product.toLowerCase())) score += 3;
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets)
      .map((x) => x.d);

    const blocks = scored.map((s) => {
      const label = `[KB:${s.product} • ${s.title}]`;
      return `${label}\n${s.text}`.trim();
    });

    let joined = blocks.join("\n\n");
    if (joined.length > DEFAULTS.maxKbChars) {
      joined = joined.slice(0, DEFAULTS.maxKbChars) + "\n\n[KB:truncated]";
    }

    return { snippets: scored, joinedText: joined };
  }
}

function normalizeFactsToSnippets(factsList) {
  const snippets = [];
  for (const facts of factsList) {
    const product = facts.product || facts.slug || "Unknown";
    const tagline = facts.tagline || "";
    const capabilities = Array.isArray(facts.capabilities) ? facts.capabilities : [];
    const metrics = facts.metrics || null;
    const runbooks = Array.isArray(facts.runbooks) ? facts.runbooks : [];

    if (tagline) {
      snippets.push({ id: `${product}-tagline`, product, title: "Overview", text: tagline });
    }

    if (capabilities.length) {
      snippets.push({
        id: `${product}-capabilities`,
        product,
        title: "Capabilities",
        text: capabilities.map((c) => `- ${c}`).join("\n")
      });
    }

    if (metrics && typeof metrics === "object") {
      const lines = Object.entries(metrics).map(([k, v]) => `- ${k}: ${formatMetric(v)}`);
      snippets.push({ id: `${product}-metrics`, product, title: "Metrics", text: lines.join("\n") });
    }

    for (const rb of runbooks) {
      const title = rb.title || "Runbook";
      const steps = Array.isArray(rb.steps) ? rb.steps : [];
      if (!steps.length) continue;

      snippets.push({
        id: `${product}-runbook-${slugify(title)}`,
        product,
        title,
        text: steps.map((s) => `- ${s}`).join("\n")
      });
    }
  }
  return snippets;
}

function formatMetric(v) {
  if (typeof v === "number") {
    if (v >= 0 && v <= 1) return v.toFixed(3);
    return String(Math.round(v * 1000) / 1000);
  }
  return String(v);
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

/**
 * Agent Router
 */
export class ApexGridAgent {
  constructor(rootEl, opts = {}) {
    this.root = rootEl;
    this.opts = { ...DEFAULTS, ...opts };
    this.mode = "ollama";
    this.messages = [];
    this.kb = new LocalKb({ baseUrl: "./assets" });

    this._reqId = 0;
    this._heurPrevText = "";

    this.ui = {
      modeButtons: $all(this.root, "[data-ai-mode]"),
      statusText: $(this.root, "[data-ai-status-text]"),
      statusDot: $(this.root, "[data-ai-status-dot]"),
      transcript: $(this.root, "[data-ai-transcript]"),
      messagesWrap: $(this.root, "[data-ai-messages]"),
      input: $(this.root, "[data-ai-input]"),
      send: $(this.root, "[data-ai-send]"),
      clear: $(this.root, "[data-ai-clear]"),
      suggests: $all(this.root, "[data-ai-suggest]"),
      sources: $(this.root, "[data-ai-sources]"),
      includeSources: $(this.root, "[data-ai-include-sources]")
    };
  }

  async init() {
    await this.kb.init();
    this.messages = [{ role: "system", content: this.opts.systemPrompt }];

    this._wireModeToggle();
    this._wireSend();
    this._wireClear();
    this._wireSuggests();

    this._setStatus("Ready (local)", "ok");
  }

  async respond(userText, onToken = () => {}) {
    const text = (userText || "").trim();
    if (!text) return "";

    const reqId = ++this._reqId;

    if (DEBUG_AGENT) console.log(`[Agent] (#${reqId}) respond()`, { text });

    this.messages.push({ role: "user", content: text });

    const includeKb = !!this.ui.includeSources?.checked;
    let kbResult = { snippets: [], joinedText: "" };

    if (includeKb) {
      kbResult = this.kb.search(text);
      this._renderSources(kbResult.snippets);

      if (kbResult.joinedText) {
        this.messages.push({
          role: "system",
          content:
            "Local knowledge snippets:\n\n" +
            kbResult.joinedText +
            "\n\nUse these if relevant; cite as [KB:Product • Title]. If not relevant, ignore."
        });
      }
    } else {
      this._renderSources([]);
    }

    if (this.mode === "ollama") {
      return await this._respondOllama(reqId, onToken);
    }

    throw new Error("Browser mode not enabled yet.");
  }

  async _respondOllama(reqId, onToken) {
    this._setStatus("Generating (local Ollama)…", "busy");

    const assistantChunks = [];
    let tokenCount = 0;
    let buffer = ""; // Holds text that *might* be a tag
    let inThinkingBlock = false;
    
    // Increased token limit to allow thinking
    const fullFromClient = await ollamaChatStream({
        host: this.opts.ollamaHost,
        model: this.opts.ollamaModel,
        messages: this.messages,
        options: { num_predict: 1024 },
        
        onToken: (t) => {
            if (typeof t !== "string") return;
            
            buffer += t;
            
            // Process buffer loop
            while (true) {
                if (!inThinkingBlock) {
                    // Look for <think>
                    const startIdx = buffer.indexOf("<think>");
                    if (startIdx !== -1) {
                        // Emit everything before tag
                        const pre = buffer.slice(0, startIdx);
                        if (pre) emitSafe(pre);
                        
                        // Switch state, remove tag from buffer
                        inThinkingBlock = true;
                        buffer = buffer.slice(startIdx + 7);
                        continue; // Re-scan remainder
                    } else {
                        // No full tag. Do we have a partial tag at the end?
                        const partialMatch = buffer.match(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/);
                        
                        if (partialMatch) {
                            // Emit safe part, keep partial tag in buffer
                            const safeLen = partialMatch.index;
                            if (safeLen > 0) {
                                const safe = buffer.slice(0, safeLen);
                                emitSafe(safe);
                                buffer = buffer.slice(safeLen);
                            }
                            break; // Wait for more
                        } else {
                            // Emit all
                            emitSafe(buffer);
                            buffer = "";
                            break;
                        }
                    }
                } else {
                    // Inside thinking block. Look for </think>
                    const endIdx = buffer.indexOf("</think>");
                    if (endIdx !== -1) {
                        // Found closing tag. Discard pre-part (it was thought).
                        inThinkingBlock = false;
                        buffer = buffer.slice(endIdx + 8);
                        continue; // Re-scan remainder
                    } else {
                        // Keep buffer minimal by discarding obviously safe thought text
                        const partialMatch = buffer.match(/<\/(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/);
                        
                        if (partialMatch) {
                            // Keep just the partial tag part
                            const keepIdx = partialMatch.index;
                            buffer = buffer.slice(keepIdx);
                            break;
                        } else {
                            // Check if we have '<' anywhere else that could be a start
                            const lastOpen = buffer.lastIndexOf("<");
                            if (lastOpen !== -1) {
                                buffer = buffer.slice(lastOpen);
                            } else {
                                buffer = ""; // Dump all thought text
                            }
                            break;
                        }
                    }
                }
            }
        }
    });
    
    // Flush remaining buffer if we are not thinking
    if (!inThinkingBlock && buffer) {
        emitSafe(buffer);
    }

    function emitSafe(str) {
       if (!str) return;
       // Valid junk check - allow pure whitespace to pass through
       if (str.trim().length > 0 && looksLikeLowEntropyJunk(str)) return;
       
       assistantChunks.push(str);
       try { onToken(str); } catch (e) { console.warn(e); }
    }

    const final = assistantChunks.join("");
    
    if (DEBUG_AGENT) {
      console.group(`[Agent] (#${reqId}) Request Complete`);
      console.log("%cRAW OUTPUT (from Model):", "color: #f59e0b; font-weight: bold;");
      console.log(fullFromClient);
      console.log("%cUI OUTPUT (Filtered):", "color: #10b981; font-weight: bold;");
      console.log(final);
      console.groupEnd();
    }

    this.messages.push({ role: "assistant", content: final });
    this._setStatus("Ready (local)", "ok");
    return final;
  }

  // -----------------------
  // UI wiring
  // -----------------------

  _wireModeToggle() {
    for (const btn of this.ui.modeButtons) {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-ai-mode");
        if (!next) return;
        if (btn.disabled) return;

        this.mode = next;

        for (const b of this.ui.modeButtons) {
          const isActive = b.getAttribute("data-ai-mode") === this.mode;
          b.toggleAttribute("data-ai-mode-active", isActive);

          if (isActive) {
            b.classList.add("bg-sky-500/90", "text-slate-950");
            b.classList.remove("text-slate-200");
          } else {
            b.classList.remove("bg-sky-500/90", "text-slate-950");
            b.classList.add("text-slate-200");
          }
        }

        this._setStatus(
          this.mode === "ollama" ? "Ready (local Ollama)" : "Ready (local browser)",
          "ok"
        );
      });
    }
  }

  _wireSend() {
    if (!this.ui.send || !this.ui.input) return;

    const doSend = async () => {
      const text = (this.ui.input.value || "").trim();
      if (!text) return;

      this.ui.input.value = "";

      this._appendBubble({
        role: "user",
        content: text,
        ts: nowIso()
      });

      const assistantEl = this._appendBubble({
        role: "assistant",
        content: "",
        ts: nowIso(),
        streaming: true
      });

      const bubbleTextEl = assistantEl.querySelector("[data-bubble-text]");
      const streamingEl = assistantEl.querySelector("[data-bubble-streaming]");

      this.ui.send.disabled = true;
      this.ui.input.disabled = true;

      let sawAnyTokens = false;

      try {
        const final = await this.respond(text, (tok) => {
          sawAnyTokens = true;
          if (bubbleTextEl) bubbleTextEl.textContent += tok;
          this._scrollTranscript();
        });

        if (bubbleTextEl) {
          const current = bubbleTextEl.textContent || "";
          if (!sawAnyTokens || current.trim().length === 0) {
            bubbleTextEl.textContent = final || "";
          } else if (final && final.length > current.length) {
            bubbleTextEl.textContent = final;
          }
        }

        if (streamingEl) streamingEl.textContent = "";
      } catch (err) {
        if (bubbleTextEl) bubbleTextEl.textContent = "Error: " + (err?.message || String(err));
        if (streamingEl) streamingEl.textContent = "";
        this._setStatus("Error", "error");
      } finally {
        this.ui.send.disabled = false;
        this.ui.input.disabled = false;
        this.ui.input.focus();
        this._scrollTranscript();
      }
    };

    this.ui.send.addEventListener("click", doSend);
    this.ui.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSend();
    });
  }

  _wireClear() {
    if (!this.ui.clear) return;
    this.ui.clear.addEventListener("click", () => {
      if (this.ui.messagesWrap) this.ui.messagesWrap.innerHTML = "";
      this.messages = [{ role: "system", content: this.opts.systemPrompt }];
      this._renderSources([]);
      this._setStatus("Ready (local)", "ok");
    });
  }

  _wireSuggests() {
    for (const btn of this.ui.suggests) {
      btn.addEventListener("click", () => {
        const t = (btn.textContent || "").trim();
        if (!t || !this.ui.input) return;
        this.ui.input.value = t;
        this.ui.input.focus();
      });
    }
  }

  _appendBubble({ role, content, ts, streaming = false }) {
    const wrap = document.createElement("div");
    wrap.className = "flex gap-3 mb-4";

    if (role === "user") {
      wrap.innerHTML = `
        <div class="h-9 w-9 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
          <span class="text-slate-200 text-xs font-bold">U</span>
        </div>
        <div class="flex-1">
          <div class="text-xs text-slate-400 mb-1">You</div>
          <div class="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap" data-bubble-text>${escapeHtml(
            content
          )}</div>
        </div>
      `;
    } else {
      wrap.innerHTML = `
        <div class="h-9 w-9 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
          <span class="text-sky-300 text-xs font-bold">AG</span>
        </div>
        <div class="flex-1">
          <div class="text-xs text-slate-400 mb-1">Assistant</div>
          <div class="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap" data-bubble-text>${escapeHtml(
            content
          )}</div>
          ${
            streaming
              ? `<div class="mt-2 text-[0.7rem] text-slate-500" data-bubble-streaming>streaming…</div>`
              : ""
          }
        </div>
      `;
    }

    this.ui.messagesWrap.appendChild(wrap);
    this._scrollTranscript();
    return wrap;
  }

  _scrollTranscript() {
    if (!this.ui.transcript) return;
    this.ui.transcript.scrollTop = this.ui.transcript.scrollHeight;
  }

  _setStatus(text, state = "ok") {
    if (this.ui.statusText) this.ui.statusText.textContent = text;

    if (this.ui.statusDot) {
      if (state === "busy") this.ui.statusDot.style.background = "#38bdf8";
      else if (state === "error") this.ui.statusDot.style.background = "#f87171";
      else this.ui.statusDot.style.background = "#34d399";
    }
  }

  _renderSources(snippets) {
    if (!this.ui.sources) return;

    if (!snippets || snippets.length === 0) {
      this.ui.sources.innerHTML = `<div class="text-xs text-slate-500 italic">No sources yet.</div>`;
      return;
    }

    const items = snippets.map((s) => {
      const title = escapeHtml(s.title || "Snippet");
      const product = escapeHtml(s.product || "KB");
      const previewText = escapeHtml((s.text || "").slice(0, 120)).replace(/\n/g, " ");
      return `
        <div class="rounded-xl border border-slate-800 bg-slate-900/30 p-3">
          <div class="text-[0.7rem] text-slate-400 mb-1">${product} • ${title}</div>
          <div class="text-xs text-slate-200">${previewText}${(s.text || "").length > 120 ? "…" : ""}</div>
        </div>
      `;
    });

    this.ui.sources.innerHTML = items.join("");
  }
}

/**
 * Bootstrap helper:
 * Call this once after the assistant card is inserted into DOM.
 */
export async function initAssistantCard({
  selector = "[data-assistant-card]",
  ollamaModel,
  ollamaHost
} = {}) {
  const root = document.querySelector(selector);
  if (!root) {
    console.warn("[Assistant] Card root not found:", selector);
    return null;
  }

  const agent = new ApexGridAgent(root, {
    ...(ollamaModel ? { ollamaModel } : {}),
    ...(ollamaHost ? { ollamaHost } : {})
  });

  await agent.init();
  return agent;
}