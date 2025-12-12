/**
 * web/js/load_cards.js
 */

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
      
      // 1. Initialize Tabs
      if (window.activateTabs) {
         window.activateTabs(wrapper);
      }

      // 2. Initialize Component Logic
      // --- GridSense ---
      if (name === 'gridsense' && window.initGridSense) {
        setTimeout(() => window.initGridSense(), 50);
      }

      // --- HelioCloud (THIS WAS MISSING) ---
      if (name === 'heliocloud' && window.initHelioCloud) {
        setTimeout(() => window.initHelioCloud(), 50);
      }
      
    } catch (err) {
      console.error(`[Cards] Failed to load card: ${name}`, err);
    }
  }

  const components = ["gridsense", "heliocloud"];
  for (const c of components) {
    await loadCard(c);
  }
}