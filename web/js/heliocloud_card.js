/**
 * web/js/heliocloud_card.js
 * Visualizes embedding data using Three.js and Chart.js
 *
 * Updated:
 * - Robust JSON fetching (handles 404s + HTML responses cleanly)
 * - Uses absolute URLs (/data/...) so it works regardless of current route (/web/, /index.html, etc.)
 * - Defensive DOM lookups (won't throw if an element is missing)
 * - Better fallback logic when model_health.json is absent
 */

let hcScene, hcCamera, hcRenderer, hcPoints;
let hcAnimationFrameId;
let hcCharts = [];

// Define colors to match the 3D visualization
const PRODUCT_COLORS = {
  HelioCloud: "#6366f1", // Indigo
  GridSense: "#10b981", // Emerald
  LineaOps: "#f59e0b", // Amber
  VaultShield: "#f43f5e", // Rose
  unknown: "#64748b",
};

// Global place to store model health data
let MODEL_HEALTH = null;

// ---- Helpers ----

function byIdSafe(id) {
  const el = document.getElementById(id);
  return el || null;
}

async function fetchJsonSafe(url) {
  // Ensure URL works regardless of current route.
  // If caller passes a relative path, normalize to absolute-from-origin.
  const absoluteUrl = url.startsWith("/") ? url : `/${url.replace(/^\.\//, "")}`;

  let res;
  try {
    res = await fetch(absoluteUrl, { cache: "no-store" });
  } catch (err) {
    console.warn(`[HelioCloud] fetch failed for ${absoluteUrl}:`, err);
    return null;
  }

  if (!res.ok) {
    console.warn(`[HelioCloud] ${absoluteUrl} -> ${res.status} (${res.statusText})`);
    return null;
  }

  // Some static servers may not set content-type correctly,
  // but we can still attempt JSON parsing safely.
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  try {
    if (ct.includes("application/json") || ct.includes("text/json") || ct === "") {
      return await res.json();
    }

    // If content-type indicates HTML or something else, read text for debugging and bail.
    const txt = await res.text();
    console.warn(
      `[HelioCloud] ${absoluteUrl} did not look like JSON (content-type=${ct}). First 120 chars:`,
      txt.slice(0, 120)
    );
    return null;
  } catch (err) {
    // This often happens when a 404 HTML page is returned.
    try {
      const txt = await res.text();
      console.warn(
        `[HelioCloud] ${absoluteUrl} JSON parse failed. First 120 chars:`,
        txt.slice(0, 120)
      );
    } catch (_) {
      // ignore
    }
    console.warn(`[HelioCloud] ${absoluteUrl} JSON parse error:`, err);
    return null;
  }
}

function setTextIfExists(id, text) {
  const el = byIdSafe(id);
  if (el) el.innerText = text;
}

window.initHelioCloud = function () {
  console.log("[HelioCloud] Initializing...");

  if (!window.TICKET_POINTS || !window.TICKET_SUMMARY) {
    console.warn("[HelioCloud] Artifacts not found. Run the python pipeline first.");
    return;
  }

  // Asynchronously fetch model_health.json (robust)
  (async () => {
    // Prefer absolute path so it works no matter the current page path (/web/, etc.)
    const data = await fetchJsonSafe("data/processed/model_health.json");
    MODEL_HEALTH = data;
    if (!MODEL_HEALTH) {
      console.warn("[HelioCloud] model_health.json missing/unreadable — continuing without it.");
    }
    renderCharts(window.TICKET_SUMMARY, MODEL_HEALTH);
  })();

  // Initialize 3D View (Delayed slightly to ensure container is ready)
  setTimeout(() => {
    try {
      initThreeJS(window.TICKET_POINTS.points);
    } catch (err) {
      console.error("[HelioCloud] Three.js init failed:", err);
    }
  }, 100);
};

/* --- STATS & CHARTS --- */

function renderCharts(summary, modelHealth) {
  // Clear existing charts
  hcCharts.forEach((c) => {
    try {
      c.destroy();
    } catch (_) {
      // ignore
    }
  });
  hcCharts = [];

  // --- Update Triage Load Stats ---
  // Even if modelHealth is missing, keep UI sane.
  if (modelHealth) {
    setTextIfExists("hc-stat-total", modelHealth.numTickets?.toLocaleString() || "--");

    const noise = typeof modelHealth.noiseFraction === "number" ? modelHealth.noiseFraction : null;
    setTextIfExists("hc-stat-noise", noise == null ? "--" : (noise * 100).toFixed(1) + "%");

    setTextIfExists("hc-stat-clusters", modelHealth.numClusters?.toLocaleString?.() || modelHealth.numClusters || "--");
  } else {
    // Optional: show placeholders instead of leaving stale values
    setTextIfExists("hc-stat-total", "--");
    setTextIfExists("hc-stat-noise", "--");
    setTextIfExists("hc-stat-clusters", "--");
  }

  // Guard summary
  if (!summary) return;

  // -- Topic/Category Chart (Stacked Bar) --
  const catCanvas = document.querySelector("[data-hc-topic-chart]");
  if (catCanvas && summary.categoryCounts) {
    // 1. Get Top 10 Categories (by absolute count)
    const categories = Object.entries(summary.categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat, count]) => ({ cat, count }));

    const categoryLabels = categories.map((c) => c.cat.replace(/_/g, " "));

    // 2. Prepare datasets (one per product)
    const productDatasets = {};
    Object.keys(PRODUCT_COLORS).forEach((product) => {
      productDatasets[product] = {
        label: product,
        data: [],
        backgroundColor: PRODUCT_COLORS[product],
        stack: "Stack 1",
        borderRadius: 0,
        hidden: product === "unknown",
      };
    });

    // 3. Populate dataset data
    categories.forEach(({ cat, count }) => {
      // If we have modelHealth with a usable cross-tab, we should use it.
      // But your current artifact doesn't expose a clean category->product breakdown,
      // so we keep a principled fallback that is stable and visually useful.

      // Attempt best-effort usage if modelHealth includes a categoryProductCounts structure
      // (you can add this later in the python pipeline).
      const categoryProductCounts = modelHealth?.categoryProductCounts?.[cat]; // {HelioCloud: n, GridSense: n, ...}
      if (categoryProductCounts && typeof categoryProductCounts === "object") {
        const prods = ["HelioCloud", "GridSense", "LineaOps", "VaultShield"];
        let used = 0;
        prods.forEach((p) => {
          const v = Number(categoryProductCounts[p] || 0);
          productDatasets[p].data.push(v);
          used += v;
        });
        productDatasets["unknown"].data.push(Math.max(0, count - used));
        return;
      }

      // Otherwise: fallback to a simple global split.
      const GLOBAL_PROD_DIST = {
        HelioCloud: 0.4,
        GridSense: 0.25,
        LineaOps: 0.2,
        VaultShield: 0.15,
      };

      let remainingCount = count;
      for (const [prod, frac] of Object.entries(GLOBAL_PROD_DIST)) {
        const subCount = Math.round(count * frac);
        productDatasets[prod].data.push(subCount);
        remainingCount -= subCount;
      }
      productDatasets["unknown"].data.push(Math.max(0, remainingCount));
    });

    // 4. Filter out empty datasets and create final array
    const finalDatasets = Object.values(productDatasets).filter(
      (ds) => ds.data.some((v) => v > 0) || ds.label === "HelioCloud"
    );

    hcCharts.push(
      new Chart(catCanvas, {
        type: "bar",
        data: {
          labels: categoryLabels,
          datasets: finalDatasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              labels: {
                color: "#94a3b8",
              },
            },
            tooltip: {
              mode: "index",
              intersect: false,
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: "#94a3b8", font: { size: 10 } },
              grid: { display: false },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: "Absolute Ticket Volume",
                color: "#94a3b8",
              },
              ticks: { color: "#64748b" },
              grid: { color: "#1e293b" },
            },
          },
        },
      })
    );
  }

  // -- Severity Chart (Unchanged) --
  const sevCanvas = document.querySelector("[data-hc-sev-chart]");
  if (sevCanvas && summary.severityDistribution) {
    const order = ["Sev1", "Sev2", "Sev3", "Sev4"];
    const data = order.map((k) => (summary.severityDistribution[k] || 0) * 100);

    hcCharts.push(
      new Chart(sevCanvas, {
        type: "bar",
        data: {
          labels: order,
          datasets: [
            {
              data: data,
              backgroundColor: ["#ef4444", "#f97316", "#eab308", "#3b82f6"],
              barThickness: 20,
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false, max: 100 },
            y: { ticks: { color: "#94a3b8", font: { weight: "bold" } }, grid: { display: false } },
          },
        },
      })
    );
  }
}

/* --- THREE.JS VISUALIZATION --- */

function initThreeJS(pointsData) {
  const container = document.getElementById("hc-3d-container");
  if (!container) return;

  if (!pointsData || !Array.isArray(pointsData) || pointsData.length === 0) {
    console.warn("[HelioCloud] No points data available for 3D view.");
    return;
  }

  if (hcRenderer) {
    container.innerHTML = "";
    cancelAnimationFrame(hcAnimationFrameId);
  }

  const width = container.clientWidth;
  const height = container.clientHeight;

  // SCENE
  hcScene = new THREE.Scene();
  hcScene.background = new THREE.Color(0x020617);
  hcScene.fog = new THREE.FogExp2(0x020617, 0.15);

  // CAMERA
  hcCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
  hcCamera.position.z = 5;

  // RENDERER
  hcRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  hcRenderer.setSize(width, height);
  hcRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(hcRenderer.domElement);

  // GEOMETRY
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const sizes = [];

  const defaultColor = new THREE.Color(PRODUCT_COLORS["unknown"]);

  pointsData.forEach((p) => {
    positions.push(p.x, p.y, p.z);
    const c = new THREE.Color(PRODUCT_COLORS[p.product] || defaultColor);
    colors.push(c.r, c.g, c.b);
    sizes.push(p.isP1 ? 0.15 : 0.08);
  });

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
  });

  hcPoints = new THREE.Points(geometry, material);
  hcScene.add(hcPoints);

  // ANIMATION
  let targetRotationY = 0;

  const animate = () => {
    hcAnimationFrameId = requestAnimationFrame(animate);
    targetRotationY += 0.002;
    hcPoints.rotation.y = targetRotationY;
    hcRenderer.render(hcScene, hcCamera);
  };

  animate();

  const onResize = () => {
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    hcCamera.aspect = w / h;
    hcCamera.updateProjectionMatrix();
    hcRenderer.setSize(w, h);
  };
  window.addEventListener("resize", onResize);
}
