import { BaseCard } from './BaseCard.js';

const PRODUCT_COLORS = {
  HelioCloud: "#6366f1",
  GridSense: "#10b981",
  LineaOps: "#f59e0b",
  VaultShield: "#f43f5e",
  unknown: "#64748b",
};

export class HelioCloudCard extends BaseCard {
  constructor() {
    super();
    this.charts = {}; 
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.points = null;
    this.animationId = null;
  }

  disconnectedCallback() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    Object.values(this.charts).forEach(c => c.destroy());
    if (this.renderer) this.renderer.dispose();
  }

  getTemplate(data) {
    const stats = data.clusterStats || {};
    const totalVol = data.numTickets?.toLocaleString() || '--';
    const density = stats.numClusters || '--';
    const noisePct = stats.noiseFraction ? (stats.noiseFraction * 100).toFixed(1) + '%' : '--';

    return `
      <section class="max-w-6xl mx-auto bg-slate-900/80 border border-slate-800 rounded-3xl p-8 shadow-xl backdrop-blur-sm fade-in">
        <div class="flex items-start justify-between gap-6 mb-8">
          <div>
            <h3 class="text-2xl font-semibold text-slate-50">
              HelioCloud — Support Intelligence
            </h3>
            <p class="mt-1 text-sm text-slate-300 max-w-xl">
              Semantic clustering and intent analysis of support tickets.
            </p>
          </div>
          <div class="inline-flex items-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs font-medium text-indigo-300 whitespace-nowrap">
            <span class="mr-2 h-2 w-2 rounded-full bg-indigo-400 animate-pulse"></span>
            NLP Pipeline Active
          </div>
        </div>

        <div class="flex flex-col min-h-[500px]">
          
          <div class="flex-none flex flex-wrap gap-6 border-b border-slate-800 text-sm font-medium text-slate-400 mb-6">
            <button type="button" data-tab="neural" class="pb-3 border-b-2 border-indigo-500 text-slate-50 transition-colors">
              Neural Atlas (3D)
            </button>
            <button type="button" data-tab="topics" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Topic Clusters
            </button>
            <button type="button" data-tab="triage" class="pb-3 border-b-2 border-transparent hover:text-slate-200 hover:border-slate-600 transition-colors">
              Triage Load
            </button>
          </div>

          <div id="content-neural" class="flex-1 flex flex-col relative min-h-0 animate-fade-in">
            <div id="hc-3d-container" class="flex-none relative rounded-2xl border border-slate-800 bg-slate-950/50 overflow-hidden w-full h-[380px] shadow-2xl"></div>
            
            <div class="absolute bottom-16 left-4 pointer-events-none">
              <h4 class="text-xs text-slate-500 mb-2 font-bold">Product Clusters:</h4>
              ${Object.entries(PRODUCT_COLORS).filter(([k]) => k !== 'unknown').map(([prod, color]) => `
                <div class="flex items-center gap-2 mb-1">
                  <span class="w-3 h-3 rounded-full" style="background-color: ${color}"></span>
                  <span class="text-xs text-slate-400">${prod}</span>
                </div>
              `).join('')}
            </div>
            
            <p class="mt-4 text-xs text-slate-500">
              The 3D space maps semantic similarity: tickets clustered close together share the same root issue.
            </p>
          </div>

          <div id="content-topics" class="hidden flex-1 min-h-0 animate-fade-in">
            <div class="relative h-[400px] w-full rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
              <canvas id="hc-topic-chart"></canvas>
            </div>
            <p class="mt-4 text-xs text-slate-500">
              Top 10 root categories by ticket volume.
            </p>
          </div>

          <div id="content-triage" class="hidden pt-2 animate-fade-in">
            <div class="grid gap-6 md:grid-cols-3">
              <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Total Volume</p>
                <p class="text-4xl font-mono text-white font-bold">${totalVol}</p>
              </div>
              <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Cluster Density</p>
                <p class="text-4xl font-mono text-emerald-400 font-bold">${density}</p>
              </div>
              <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-6">
                <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Noise Fraction</p>
                <p class="text-4xl font-mono text-indigo-400 font-bold">${noisePct}</p>
              </div>
              <div class="col-span-full rounded-2xl border border-slate-800 bg-slate-950/50 p-6 h-[200px] relative">
                 <p class="text-slate-400 text-[0.7rem] uppercase font-bold mb-2">Severity Distribution</p>
                 <div class="absolute inset-0 top-10 p-4">
                   <canvas id="hc-sev-chart"></canvas>
                 </div>
              </div>
            </div>
          </div>

        </div>
      </section>
    `;
  }

  async afterRender() {
    // 1. Setup Tab Clicks
    this.setupTabs();

    // 2. Load 3D Data immediately (Neural tab is default)
    try {
      const pointsRes = await fetch('./data/ticket_points.json');
      if (pointsRes.ok) {
        const pointsData = await pointsRes.json();
        this.initThreeJS(pointsData.points);
      } else {
        console.warn("[HelioCloud] ticket_points.json 404. Run export_web_artifacts.py again.");
      }
    } catch (e) {
      console.warn("[HelioCloud] 3D Data Error:", e);
    }
  }

  setupTabs() {
    const buttons = this.querySelectorAll('button[data-tab]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Reset UI
        buttons.forEach(b => {
          b.classList.remove('border-indigo-500', 'text-slate-50');
          b.classList.add('border-transparent', 'hover:text-slate-200');
        });
        
        ['neural', 'topics', 'triage'].forEach(id => {
          this.querySelector(`#content-${id}`).classList.add('hidden');
        });

        // Activate
        btn.classList.remove('border-transparent', 'hover:text-slate-200');
        btn.classList.add('border-indigo-500', 'text-slate-50');

        const target = btn.dataset.tab;
        const targetEl = this.querySelector(`#content-${target}`);
        targetEl.classList.remove('hidden');

        // LAZY RENDER with explicit window.Chart checks
        if (target === 'topics') this.renderTopicChart();
        if (target === 'triage') this.renderSeverityChart();
        if (target === 'neural') this.resizeThreeJS();
      });
    });
  }

  resizeThreeJS() {
    if (this.camera && this.renderer) {
       const container = this.querySelector('#hc-3d-container');
       if (container && container.clientWidth > 0) {
         this.camera.aspect = container.clientWidth / container.clientHeight;
         this.camera.updateProjectionMatrix();
         this.renderer.setSize(container.clientWidth, container.clientHeight);
       }
    }
  }

  // --- CHARTS ---

  renderTopicChart() {
    // Don't re-render if already exists
    if (this.charts['topics']) return; 

    // USE window.Chart
    if (!window.Chart) {
      console.error("Chart.js not loaded on window.");
      return;
    }

    const summary = this.data;
    if (!summary || !summary.categoryCounts) return;

    const catCanvas = this.querySelector('#hc-topic-chart');
    if (!catCanvas) return;

    // Sort top 10
    const categories = Object.entries(summary.categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    console.log('[HelioCloud] Rendering Topic Chart');

    // EXPLICIT window.Chart
    this.charts['topics'] = new window.Chart(catCanvas, {
      type: "bar",
      data: {
        labels: categories.map(([c]) => c.replace(/_/g, " ")),
        datasets: [{
          label: "Volume",
          data: categories.map(([, v]) => v),
          backgroundColor: "#6366f1",
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { ticks: { color: "#64748b" }, grid: { color: "#1e293b" } }
        }
      }
    });
  }

  renderSeverityChart() {
    if (this.charts['severity']) return;
    if (!window.Chart) return;

    const summary = this.data;
    if (!summary || !summary.severityDistribution) return;

    const sevCanvas = this.querySelector('#hc-sev-chart');
    if (!sevCanvas) return;

    const order = ["Sev1", "Sev2", "Sev3", "Sev4"];
    const data = order.map(k => (summary.severityDistribution[k] || 0) * 100);

    console.log('[HelioCloud] Rendering Sev Chart');

    // EXPLICIT window.Chart
    this.charts['severity'] = new window.Chart(sevCanvas, {
      type: "bar",
      data: {
        labels: order,
        datasets: [{
          data: data,
          backgroundColor: ["#ef4444", "#f97316", "#eab308", "#3b82f6"],
          barThickness: 20,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false, max: 100 },
          y: { ticks: { color: "#94a3b8", font: { weight: "bold" } }, grid: { display: false } }
        }
      }
    });
  }

  // --- THREE.JS ---

  initThreeJS(pointsData) {
    // EXPLICIT window.THREE
    if (!window.THREE || !pointsData) return;
    
    const container = this.querySelector("#hc-3d-container");
    if (!container) return;
    container.innerHTML = ""; 

    const width = container.clientWidth;
    const height = container.clientHeight;

    this.scene = new window.THREE.Scene();
    this.scene.background = new window.THREE.Color(0x020617);
    this.scene.fog = new window.THREE.FogExp2(0x020617, 0.15);

    this.camera = new window.THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    this.camera.position.z = 5;

    this.renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    if (window.THREE.OrbitControls) {
       const controls = new window.THREE.OrbitControls(this.camera, this.renderer.domElement);
       controls.enableDamping = true;
       controls.autoRotate = true;
       controls.autoRotateSpeed = 1.0;
    }

    const geometry = new window.THREE.BufferGeometry();
    const positions = [];
    const colors = [];
    const sizes = [];
    const defaultColor = new window.THREE.Color(PRODUCT_COLORS["unknown"]);

    pointsData.forEach(p => {
      positions.push(p.x, p.y, p.z);
      const c = new window.THREE.Color(PRODUCT_COLORS[p.product] || defaultColor);
      colors.push(c.r, c.g, c.b);
      sizes.push(p.isP1 ? 0.15 : 0.08);
    });

    geometry.setAttribute("position", new window.THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new window.THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("size", new window.THREE.Float32BufferAttribute(sizes, 1));

    const material = new window.THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    });

    this.points = new window.THREE.Points(geometry, material);
    this.scene.add(this.points);

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      if(!window.THREE.OrbitControls) {
         this.points.rotation.y += 0.002;
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
}

customElements.define('heliocloud-card', HelioCloudCard);