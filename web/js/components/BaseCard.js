/**
 * Base class for ApexGrid dashboard cards.
 * UPDATED: Now correctly saves 'this.data' so subclasses can use it in afterRender().
 */
export class BaseCard extends HTMLElement {
  constructor() {
    super();
    this.data = null; // Initialize storage
  }

  async connectedCallback() {
    // 1. Initial Loading State
    this.innerHTML = `
      <div id="container" class="opacity-0 transition-opacity duration-500">
        <div class="p-8 border border-slate-800 rounded-3xl bg-slate-900/50 animate-pulse">
          <div class="h-6 w-1/3 bg-slate-800 rounded mb-4"></div>
          <div class="h-4 w-1/4 bg-slate-800 rounded"></div>
        </div>
      </div>
    `;

    // 2. Load data
    const dataUrl = this.getAttribute('data-url');
    if (dataUrl) {
      try {
        const jsonData = await this.fetchJson(dataUrl);
        this.data = jsonData; // <--- CRITICAL FIX: Save data for subclasses
        
        this.render(this.data);
        
        // Fade in
        const container = this.querySelector('#container');
        if (container) {
          container.classList.remove('opacity-0');
          container.classList.add('fade-in');
        }
        
        // Run subclass logic (charts, etc.)
        this.afterRender();
      } catch (err) {
        console.error(`[${this.tagName}] Data load failed:`, err);
        this.innerHTML = `
          <div class="p-4 border border-red-800 bg-red-900/20 text-red-400 rounded-xl">
             <strong>Error loading card:</strong> ${err.message}
          </div>`;
      }
    }
  }

  async fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  getTemplate(data) {
    return `<div>Override getTemplate() in subclass</div>`;
  }

  render(data) {
    const container = this.querySelector('#container');
    if (container) {
      container.innerHTML = this.getTemplate(data);
    }
  }

  afterRender() {}
}