function renderSparkline(ctx, scores) {
    return new Chart(ctx, {
        type: "line",
        data: {
            labels: scores.map((_, i) => i),
            datasets: [{
                data: scores,
                borderColor: "#4ade80",
                backgroundColor: "rgba(74,222,128,0.1)",
                tension: 0.25,
                pointRadius: 0,
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { display: false }, y: { display: false } },
            plugins: { legend: { display: false } }
        }
    });
}
