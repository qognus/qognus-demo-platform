/**
 * web/js/load_cards.js
 * Dynamically loads HTML components for the Qognus Demo Platform.
 */

import { initAssistantCard } from "./agent_router.js";

export async function loadAllCards() {
  const container = document.getElementById("cardContainer");
  
  if (!container) {
    console.warn("[Cards] Container element 'cardContainer' not found.");
    return;
  }

  async function loadCard(name) {
    const url = `./components/${name}_card.html`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      
      // Create a wrapper div for the card
      const wrapper = document.createElement("div");
      wrapper.classList.add("fade-in", "w-full");
      wrapper.innerHTML = html;

      container.appendChild(wrapper);
      console.log(`[Cards] Injected HTML for ${name}`);
      
      // 1. Initialize Tabs (if tabs.js is loaded)
      if (window.activateTabs) {
         window.activateTabs(wrapper);
      }

      // 2. Initialize Component Logic
      
      // --- Assistant (New) ---
      if (name === 'assistant') {
        // Initialize the agent router for this card
        // We allow a brief moment for DOM painting, though usually not strictly required
        await initAssistantCard(); 
      }

      // --- GridSense ---
      if (name === 'gridsense' && window.initGridSense) {
        setTimeout(() => window.initGridSense(), 50);
      }

      // --- HelioCloud ---
      if (name === 'heliocloud' && window.initHelioCloud) {
        setTimeout(() => window.initHelioCloud(), 50);
      }
      
      // --- VaultShield ---
      if (name === 'vaultshield' && window.initVaultShield) {
        setTimeout(() => window.initVaultShield(), 50);
      }
      
    } catch (err) {
      console.error(`[Cards] Failed to load card: ${name}`, err);
    }
  }

  // We load the assistant first so it appears at the top of the feed
  const components = ["assistant", "gridsense", "heliocloud", "vaultshield"];
  
  for (const c of components) {
    await loadCard(c);
  }
}