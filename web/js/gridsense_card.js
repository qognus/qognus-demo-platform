// web/js/gridsense_card.js

window.initGridSense = function () {
  console.log('[GridSense] Initializing...');

  if (!window.GRIDSENSE_TIMESERIES) {
    console.warn('[GridSense] Artifact not found.');
    return;
  }

  const dataObj = window.GRIDSENSE_TIMESERIES;
  const series = dataObj.series;
  const metrics = dataObj.summary;

  // --- NEW: SMART SELECTION LOGIC ---
  // Instead of just taking series[0], we find the substation 
  // with the highest number of anomalies.
  const subStats = {};
  
  // 1. Group and count anomalies per substation
  series.forEach(d => {
    if (!subStats[d.substation_id]) {
        subStats[d.substation_id] = { id: d.substation_id, count: 0, data: [] };
    }
    subStats[d.substation_id].data.push(d);
    if (d.predicted_anomaly === 1) {
        subStats[d.substation_id].count++;
    }
  });

  // 2. Sort by anomaly count (descending)
  const sortedSubs = Object.values(subStats).sort((a, b) => b.count - a.count);
  
  // 3. Pick the winner (or the first one if everyone is clean)
  const bestSub = sortedSubs[0];
  
  console.log(`[GridSense] Selected ${bestSub.id} with ${bestSub.count} anomalies.`);

  // Render
  renderTimeseries(bestSub.data, bestSub.id);
  renderPseudoEmbedding(series);
  updateHealthMetrics(metrics);
};

/**
 * Renders the time-series chart with a blue signal line and explicit red dots for anomalies.
 */
function renderTimeseries(dataPoints, subId) {
  const canvas = document.querySelector('[data-gs-timeseries]');
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext('2d');

  // Limit to last 150 points for a clean, readable view
  const slice = dataPoints.slice(-150); 
  
  // Prepare Labels (HH:MM)
  const labels = slice.map(d => {
    const date = new Date(d.timestamp);
    return `${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  });
  
  // Main Signal Data
  const scores = slice.map(d => d.anomaly_score || 0);

  // Anomaly Dots Data: 
  // We map normal points to 'null' so Chart.js skips drawing them in this dataset.
  const anomalyDots = slice.map(d => d.predicted_anomaly === 1 ? (d.anomaly_score || 0) : null);
  
  // Clean up previous chart instance if it exists
  if (canvas._gsChart) canvas._gsChart.destroy();

  canvas._gsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        // Dataset 1: The Main Signal Line
        {
          label: 'Normal Score',
          data: scores,
          borderColor: '#38bdf8', // Sky Blue
          borderWidth: 2,
          // Segment styling: Color the line segment red if it connects to an anomaly
          segment: {
            borderColor: ctx => {
              const i = ctx.p1DataIndex;
              return slice[i].predicted_anomaly === 1 ? '#ef4444' : '#38bdf8';
            }
          },
          backgroundColor: (context) => {
            const chart = context.chart;
            const {ctx, chartArea} = chart;
            if (!chartArea) return null;
            // Subtle blue gradient fill
            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            gradient.addColorStop(0, 'rgba(56, 189, 248, 0.0)');
            gradient.addColorStop(1, 'rgba(56, 189, 248, 0.2)');
            return gradient;
          },
          fill: true,
          pointRadius: 0, // Hide points on the main line for a smooth look
          tension: 0.1,
          order: 2 // Render behind the dots
        },
        // Dataset 2: Explicit Red Dots for Anomalies
        {
          label: 'Anomaly Detected',
          data: anomalyDots,
          borderColor: '#ef4444', // Red
          backgroundColor: '#ef4444',
          pointRadius: 4, 
          pointHoverRadius: 6,
          showLine: false, // Don't connect these dots
          order: 1 // Render on top of the line
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { 
          display: true,
          min: 0, 
          // Dynamic headroom so peaks don't hit the ceiling
          suggestedMax: Math.max(...scores) * 1.1,
          grid: { color: 'rgba(30, 64, 175, 0.2)' },
          ticks: { color: '#64748b', font: {size: 10} }
        }
      }
    }
  });

  // Update footer text to show which substation we are viewing
  const footer = document.getElementById('gs-timeseries-footer');
  if(footer) footer.innerHTML = `Visualization of real inference scores for <span class="font-mono text-sky-400">${subId}</span>.`;
}

/**
 * Renders a "Pseudo-Embedding" scatter plot.
 * Mapping: Radius = Anomaly Score (High score = further from center).
 */
function renderPseudoEmbedding(allSeriesData) {
  const canvas = document.querySelector('[data-gs-embedding]');
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext('2d');

  // Downsample: Take ~1000 random points max to keep performance high
  const maxPoints = 1000;
  const step = Math.ceil(allSeriesData.length / maxPoints);
  const data = [];

  for (let i = 0; i < allSeriesData.length; i += step) {
    const point = allSeriesData[i];
    const score = point.anomaly_score || 0;
    const isAnom = point.predicted_anomaly === 1;

    // Pseudo-Projection Logic:
    // Normal points cluster near center (0,0) with random noise.
    // Anomalies explode outward based on score magnitude.
    const angle = Math.random() * Math.PI * 2;
    // Radius base: score is exponentiated slightly to push anomalies visibly out
    const r = (Math.random() * 0.5) + (score * 5.0); 

    data.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      isAnom: isAnom,
      score: score
    });
  }

  // Split into two datasets for easier coloring/legend
  const normalPoints = data.filter(d => !d.isAnom);
  const anomalyPoints = data.filter(d => d.isAnom);

  if (canvas._gsEmbedChart) canvas._gsEmbedChart.destroy();

  canvas._gsEmbedChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Nominal',
          data: normalPoints,
          backgroundColor: '#38bdf8', // Sky Blue
          pointRadius: 2
        },
        {
          label: 'Anomaly',
          data: anomalyPoints,
          backgroundColor: '#ef4444', // Red
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        // Hide axes for a cleaner "embedding space" look
        x: { display: false, min: -6, max: 6 },
        y: { display: false, min: -6, max: 6 }
      },
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8' } },
        tooltip: {
          callbacks: {
            label: (ctx) => `Score: ${ctx.raw.score.toFixed(3)}`
          }
        }
      }
    }
  });
}

/**
 * Updates the HTML text elements with metrics from the JSON artifact.
 */
function updateHealthMetrics(metrics) {
  const setVal = (id, val, colorClass) => {
    const el = document.getElementById(id);
    if(el) {
        el.innerText = val;
        // Reset classes and apply new ones
        el.className = ''; 
        if(colorClass) el.className = `text-2xl font-bold font-mono ${colorClass}`;
    }
  };

  const prec = (metrics.precision * 100).toFixed(1) + '%';
  const rec = (metrics.recall * 100).toFixed(1) + '%';
  const cont = (metrics.contamination * 100).toFixed(1) + '%';

  // Use coloring to indicate health (Emerald = Good, Amber = Warning)
  setVal('gs-metric-precision', prec, 'text-emerald-400');
  setVal('gs-metric-recall', rec, 'text-emerald-400');
  setVal('gs-metric-rate', cont, 'text-sky-400');
}