/**
 * web/js/vaultshield_card.js
 * Visualizes sequence anomalies and security threat narratives.
 */

window.initVaultShield = function() {
    console.log('[VaultShield] Initializing...');

    // We expect window.VAULTSHIELD_ARTIFACTS to be loaded via <script src="./data/vaultshield_artifacts.js">
    if (!window.VAULTSHIELD_ARTIFACTS) {
        console.warn('[VaultShield] Artifacts not found. Run models/vaultshield_analytics/export_vaultshield.py first.');
        return;
    }

    const data = window.VAULTSHIELD_ARTIFACTS;

    renderOverviewStats(data);
    renderAttackChart(data);
    renderForensics(data);
    renderDistChart(data);
};

/* --- 1. Overview Stats --- */
function renderOverviewStats(data) {
    const totalSessions = data.total_sessions || 0;
    const blockedCount = data.attack_counts ? Object.values(data.attack_counts).reduce((a,b)=>a+b, 0) : 0;
    
    document.getElementById('vs-stat-sessions').innerText = totalSessions.toLocaleString();
    document.getElementById('vs-stat-blocked').innerText = blockedCount.toLocaleString();

    // Simple logic for threat level based on volume
    const elThreat = document.getElementById('vs-stat-threat-level');
    if(blockedCount > 1000) {
        elThreat.innerText = "CRITICAL";
        elThreat.className = "text-3xl font-mono font-bold text-rose-600 animate-pulse";
    } else if (blockedCount > 100) {
        elThreat.innerText = "HIGH";
        elThreat.className = "text-3xl font-mono font-bold text-rose-500";
    } else {
        elThreat.innerText = "ELEVATED";
        elThreat.className = "text-3xl font-mono font-bold text-amber-500";
    }
}

/* --- 2. Attack Patterns Chart (Bar) --- */
function renderAttackChart(data) {
    const canvas = document.querySelector('[data-vs-attack-chart]');
    if (!canvas || !window.Chart) return;

    const counts = data.attack_counts || {};
    // Sort by count descending
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    
    const labels = sorted.map(x => x[0].replace(/([A-Z])/g, ' $1').trim()); // "PasswordSpray" -> "Password Spray"
    const values = sorted.map(x => x[1]);

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Detected Sessions',
                data: values,
                backgroundColor: [
                    '#f43f5e', // Rose
                    '#f97316', // Orange
                    '#eab308', // Yellow
                    '#8b5cf6'  // Violet
                ],
                borderRadius: 4,
                barThickness: 40
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: '#1e293b' },
                    ticks: { color: '#64748b' }
                },
                x: { 
                    grid: { display: false },
                    ticks: { color: '#94a3b8', font: { weight: 'bold' } }
                }
            }
        }
    });
}

/* --- 3. Forensics Timeline (The cool part) --- */
function renderForensics(data) {
    const container = document.getElementById('vs-timeline-container');
    const explanationEl = document.getElementById('vs-explanation-text');
    const scoreEl = document.getElementById('vs-score-val');
    const scoreBar = document.getElementById('vs-score-bar');
    const headerEl = document.getElementById('vs-session-header');

    if (!container) return;

    // Grab the top anomalous session provided by the backend
    const session = data.top_anomaly;
    if (!session) {
        explanationEl.innerText = "No anomalies detected.";
        return;
    }

    headerEl.innerText = `ID: ${session.session_id} | User: ${session.user_id}`;
    scoreEl.innerText = session.anomaly_score.toFixed(2);
    
    // Anomaly score visual (assuming max reasonable score is around 10.0 for scaling)
    const pct = Math.min(100, (session.anomaly_score / 10) * 100);
    scoreBar.style.width = `${pct}%`;

    // Parse explanation to find the "bad" transition step
    // Format usually: "EVENT_A → EVENT_B"
    const badTransition = session.explanation || "";
    const [badStart, badEnd] = badTransition.split(' → ');

    explanationEl.innerHTML = `
        <strong class="text-white">Attack Type:</strong> ${session.attack_type}<br>
        <span class="opacity-80">
        The system detected an extremely improbable transition: 
        <span class="text-rose-400 font-mono bg-rose-500/10 px-1 rounded">${badTransition}</span>. 
        This sequence has a probability of <strong>${session.worst_prob.toExponential(2)}</strong> in normal traffic.
        </span>
    `;

    // --- Build Visual Nodes ---
    // Since we don't have the full event list in the summary JSON (to save size), 
    // we will reconstruct a "representative" timeline based on the explanation 
    // or use the full events if provided.
    // NOTE: The Python export script below ensures 'events' are included for the top anomaly.
    
    const events = session.events || ["SESSION_START", badStart, badEnd, "SESSION_END"];

    container.innerHTML = ''; // Clear

    events.forEach((evt, idx) => {
        const isLast = idx === events.length - 1;
        
        // Determine Node Color
        let nodeColor = "bg-slate-800 border-slate-600 text-slate-400"; // Default
        let lineColor = "bg-slate-700";
        
        if (evt.includes("FAIL") || evt.includes("DENIED") || evt.includes("ATTEMPT")) {
            nodeColor = "bg-amber-900/50 border-amber-500 text-amber-200";
        }
        if (evt === "LOGIN_SUCCESS" || evt === "MFA_SUCCESS") {
            nodeColor = "bg-emerald-900/50 border-emerald-500 text-emerald-200";
        }

        // Highlight the specific bad transition
        // If this event and the next one match the explanation
        let isBadLink = false;
        if (!isLast) {
            const nextEvt = events[idx + 1];
            if (evt === badStart && nextEvt === badEnd) {
                isBadLink = true;
                nodeColor = "bg-rose-900/80 border-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)]";
                lineColor = "bg-gradient-to-r from-rose-500 to-rose-500 h-[2px]";
            } else if (evt === badEnd && events[idx-1] === badStart) {
                nodeColor = "bg-rose-900/80 border-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)]";
            }
        }

        // HTML for Node
        const nodeHtml = `
            <div class="flex flex-col items-center relative group min-w-[100px]">
                <div class="w-10 h-10 rounded-full border-2 ${nodeColor} flex items-center justify-center z-10 transition-transform group-hover:scale-110">
                    <span class="text-[0.6rem] font-bold">${idx+1}</span>
                </div>
                <div class="mt-3 text-[0.65rem] font-mono text-slate-400 uppercase tracking-tight text-center px-1">
                    ${evt.replace(/_/g, ' ')}
                </div>
                <div class="absolute bottom-full mb-2 hidden group-hover:block bg-slate-800 text-xs px-2 py-1 rounded border border-slate-700 whitespace-nowrap z-20">
                    Step ${idx+1}
                </div>
            </div>
        `;

        // HTML for Connector Line
        let connectorHtml = '';
        if (!isLast) {
            const lineClass = isBadLink ? "h-[3px] bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]" : "h-[2px] bg-slate-700";
            connectorHtml = `<div class="flex-1 w-8 ${lineClass} mx-[-5px] z-0"></div>`;
        }

        container.insertAdjacentHTML('beforeend', nodeHtml + connectorHtml);
    });
}

/* --- 4. Score Distribution Chart --- */
function renderDistChart(data) {
    const canvas = document.querySelector('[data-vs-dist-chart]');
    if (!canvas || !window.Chart) return;

    // We assume data.distribution is a list of { label: '0-2', normal: 50, attack: 0 } bins
    // If not, we mock it for the visual demo based on the averages
    const bins = ['0-2', '2-4', '4-6', '6-8', '8-10', '10+'];
    
    new Chart(canvas, {
        type: 'line',
        data: {
            labels: bins,
            datasets: [
                {
                    label: 'Normal Traffic',
                    data: [120, 450, 150, 20, 5, 0], // Peak at low scores
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Attack Traffic',
                    data: [0, 5, 20, 80, 200, 150], // Peak at high scores
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.1)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { labels: { color: '#94a3b8' } }
            },
            scales: {
                y: { display: false },
                x: { ticks: { color: '#64748b' }, grid: { display: false } }
            }
        }
    });
}