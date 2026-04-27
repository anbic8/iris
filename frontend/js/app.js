const API = "/api";
let currentUser = null;
let allActivities = [];
let chartInstance = null;

const SPORT_COLORS = { running: "#4f8ef7", cycling: "#43c59e", hiking: "#f7b84f", other: "#a0a0a0" };
const SPORT_NAMES  = { running: "Laufen", cycling: "Radfahren", hiking: "Wandern", other: "Sonstiges" };
const SPORT_ICONS  = { running: "🏃", cycling: "🚴", hiking: "🥾", other: "🏅" };
const MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

// --- HTTP ---
async function request(method, url, body) {
    const res = await fetch(API + url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Request failed");
    }
    return res.status === 204 ? null : res.json();
}

// --- Helpers ---
function getYear(a)  { return new Date(a.start_time).getFullYear(); }
function getMonth(a) { return new Date(a.start_time).getMonth(); }
function getYears()  { return [...new Set(allActivities.map(getYear))].sort((a, b) => b - a); }

function computeStats(acts) {
    return {
        count: acts.length,
        km:    acts.reduce((s, a) => s + a.distance_m / 1000, 0),
        time:  acts.reduce((s, a) => s + a.duration_s, 0),
        ele:   acts.reduce((s, a) => s + (a.elevation_gain_m || 0), 0),
    };
}

function delta(curr, prev, decimals = 0) {
    if (!prev || prev === 0) return "";
    const diff = curr - prev;
    if (Math.abs(diff) < 0.05) return "";
    const cls  = diff > 0 ? "delta-up" : "delta-down";
    const sign = diff > 0 ? "+" : "";
    const val  = decimals > 0 ? diff.toFixed(decimals) : Math.round(diff);
    return `<span class="${cls}">${sign}${val}</span>`;
}

function destroyChart() {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

// --- Auth ---
function showLogin() {
    document.getElementById("login-page").classList.remove("hidden");
    document.getElementById("main-page").classList.add("hidden");
}

function showMain() {
    document.getElementById("nav-user").textContent = currentUser.name;
    document.getElementById("login-page").classList.add("hidden");
    document.getElementById("main-page").classList.remove("hidden");
    loadDashboard();
}

async function init() {
    try {
        currentUser = await request("GET", "/users/me");
        allActivities = await request("GET", "/activities/");
        showMain();
    } catch {
        showLogin();
    }
}

// --- Dashboard ---
function loadDashboard() {
    const years = getYears();
    renderDashboard(years[0] || new Date().getFullYear(), years);
}

function renderDashboard(year, years) {
    destroyChart();
    const content = document.getElementById("content");

    const curr = computeStats(allActivities.filter(a => getYear(a) === year));
    const prev = computeStats(allActivities.filter(a => getYear(a) === year - 1));

    const sports = ["running", "cycling", "hiking", "other"];
    const monthlyBySport = {};
    sports.forEach(sport => {
        monthlyBySport[sport] = MONTHS.map((_, m) =>
            allActivities
                .filter(a => getYear(a) === year && getMonth(a) === m && a.sport_type === sport)
                .reduce((s, a) => s + a.distance_m / 1000, 0)
        );
    });

    const yearTabs = years.map(y =>
        `<button class="year-tab${y === year ? " active" : ""}" data-year="${y}">${y}</button>`
    ).join("");

    const recent = allActivities.filter(a => getYear(a) === year).slice(0, 8);

    content.innerHTML = `
        <div class="page-header">
            <h2>Dashboard</h2>
            <div class="year-tabs">${yearTabs}</div>
        </div>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${curr.count}</div>
                <div class="stat-label">Aktivitäten ${delta(curr.count, prev.count)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${curr.km.toFixed(1)}</div>
                <div class="stat-label">km gesamt ${delta(curr.km, prev.km, 1)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${fmtDuration(curr.time)}</div>
                <div class="stat-label">Gesamtzeit</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Math.round(curr.ele)}</div>
                <div class="stat-label">Höhenmeter ${delta(curr.ele, prev.ele)}</div>
            </div>
        </div>
        <h3>km pro Monat</h3>
        <div class="chart-box"><canvas id="monthly-chart"></canvas></div>
        <h3>Aktivitäten ${year}</h3>
        <div class="activity-list">${recent.map(activityCard).join("") || "<p>Keine Aktivitäten in diesem Jahr.</p>"}</div>
    `;

    const activeSports = sports.filter(s => monthlyBySport[s].some(v => v > 0));
    chartInstance = new Chart(document.getElementById("monthly-chart").getContext("2d"), {
        type: "bar",
        data: {
            labels: MONTHS,
            datasets: activeSports.map(sport => ({
                label: SPORT_NAMES[sport],
                data: monthlyBySport[sport],
                backgroundColor: SPORT_COLORS[sport],
                borderRadius: 3,
            })),
        },
        options: {
            responsive: true,
            plugins: { legend: { position: "top" } },
            scales: {
                x: { stacked: true },
                y: { stacked: true, title: { display: true, text: "km" } },
            },
        },
    });

    document.querySelectorAll(".year-tab").forEach(btn => {
        btn.addEventListener("click", () => renderDashboard(parseInt(btn.dataset.year), years));
    });
    document.querySelectorAll(".activity-card").forEach(el => {
        el.addEventListener("click", () => loadActivity(parseInt(el.dataset.id)));
    });
}

// --- Activity list ---
function loadActivities() {
    renderActivities("all", "all", "date");
}

function renderActivities(sport, year, sort) {
    destroyChart();
    const content = document.getElementById("content");
    const years = getYears();

    let filtered = allActivities;
    if (sport !== "all") filtered = filtered.filter(a => a.sport_type === sport);
    if (year !== "all") filtered = filtered.filter(a => getYear(a) === parseInt(year));

    if (sort === "distance") filtered = [...filtered].sort((a, b) => b.distance_m - a.distance_m);
    else if (sort === "pace")  filtered = [...filtered].filter(a => a.avg_pace).sort((a, b) => a.avg_pace - b.avg_pace);
    else                       filtered = [...filtered].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

    const sportBtns = ["all", "running", "cycling", "hiking", "other"].map(s =>
        `<button class="filter-btn${sport === s ? " active" : ""}" data-sport="${s}">
            ${s === "all" ? "Alle" : SPORT_ICONS[s] + " " + SPORT_NAMES[s]}
        </button>`
    ).join("");

    const yearOpts = ["all", ...years].map(y =>
        `<option value="${y}"${y == year ? " selected" : ""}>${y === "all" ? "Alle Jahre" : y}</option>`
    ).join("");

    const sortOpts = [["date","Datum"],["distance","Distanz"],["pace","Pace"]].map(([v, l]) =>
        `<option value="${v}"${sort === v ? " selected" : ""}>${l}</option>`
    ).join("");

    content.innerHTML = `
        <div class="page-header"><h2>Aktivitäten (${filtered.length})</h2></div>
        <div class="filter-bar">
            <div class="filter-group">${sportBtns}</div>
            <div class="filter-group">
                <select id="year-select">${yearOpts}</select>
                <select id="sort-select">${sortOpts}</select>
            </div>
        </div>
        <div class="activity-list">${filtered.map(activityCard).join("") || "<p>Keine Aktivitäten gefunden.</p>"}</div>
    `;

    const rerender = () => {
        const y = document.getElementById("year-select").value;
        const s = document.getElementById("sort-select").value;
        renderActivities(
            document.querySelector(".filter-btn.active")?.dataset.sport ?? "all",
            y === "all" ? "all" : parseInt(y),
            s
        );
    };

    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            rerender();
        });
    });
    document.getElementById("year-select").addEventListener("change", rerender);
    document.getElementById("sort-select").addEventListener("change", rerender);
    document.querySelectorAll(".activity-card").forEach(el => {
        el.addEventListener("click", () => loadActivity(parseInt(el.dataset.id)));
    });
}

// --- Single activity ---
async function loadActivity(id) {
    destroyChart();
    const content = document.getElementById("content");
    content.innerHTML = "<p>Lade…</p>";
    try {
        const [activity, trackpoints] = await Promise.all([
            request("GET", `/activities/${id}`),
            request("GET", `/activities/${id}/trackpoints`),
        ]);
        content.innerHTML = `
            <div class="page-header">
                <h2>${SPORT_ICONS[activity.sport_type] ?? "🏅"} ${fmtDate(activity.start_time)}</h2>
                <button class="btn-secondary" id="back-btn">← Zurück</button>
            </div>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${(activity.distance_m / 1000).toFixed(2)}</div><div class="stat-label">km</div></div>
                <div class="stat-card"><div class="stat-value">${fmtDuration(activity.duration_s)}</div><div class="stat-label">Zeit</div></div>
                ${activity.avg_pace ? `<div class="stat-card"><div class="stat-value">${fmtPace(activity.avg_pace)}</div><div class="stat-label">Ø Pace /km</div></div>` : ""}
                ${activity.avg_hr ? `<div class="stat-card"><div class="stat-value">${activity.avg_hr}</div><div class="stat-label">Ø HR bpm</div></div>` : ""}
                ${activity.max_hr ? `<div class="stat-card"><div class="stat-value">${activity.max_hr}</div><div class="stat-label">Max HR bpm</div></div>` : ""}
                ${activity.elevation_gain_m ? `<div class="stat-card"><div class="stat-value">${Math.round(activity.elevation_gain_m)}</div><div class="stat-label">Höhenmeter</div></div>` : ""}
            </div>
            <div id="map"></div>
        `;
        document.getElementById("back-btn").addEventListener("click", loadActivities);
        if (trackpoints.length > 0) renderMap(trackpoints);
    } catch (e) {
        content.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

function renderMap(trackpoints) {
    const map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    const latlngs = trackpoints.map(p => [p.lat, p.lon]);
    const poly = L.polyline(latlngs, { color: "#1a1a2e", weight: 3 }).addTo(map);
    map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    L.marker(latlngs[0]).addTo(map).bindPopup("Start");
    L.marker(latlngs[latlngs.length - 1]).addTo(map).bindPopup("Ziel");
}

// --- Activity card ---
function activityCard(a) {
    return `<div class="activity-card" data-id="${a.id}">
        <span class="act-sport">${SPORT_ICONS[a.sport_type] ?? "🏅"}</span>
        <div class="act-info">
            <div class="act-title">${fmtDate(a.start_time)}</div>
            <div class="act-meta">
                ${(a.distance_m / 1000).toFixed(2)} km
                · ${fmtDuration(a.duration_s)}
                ${a.avg_pace ? " · " + fmtPace(a.avg_pace) + " /km" : ""}
                ${a.avg_hr ? " · ♥ " + a.avg_hr : ""}
                ${a.elevation_gain_m ? " · ↑ " + Math.round(a.elevation_gain_m) + " m" : ""}
            </div>
        </div>
    </div>`;
}

// --- Formatters ---
function fmtDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDuration(seconds) {
    if (!seconds) return "–";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(minPerKm) {
    if (!minPerKm) return "–";
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

// --- Event listeners ---
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("login-error");
    errEl.classList.add("hidden");
    try {
        currentUser = await request("POST", "/users/login", {
            email: document.getElementById("email").value,
            password: document.getElementById("password").value,
        });
        allActivities = await request("GET", "/activities/");
        showMain();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
    }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
    await request("POST", "/users/logout").catch(() => {});
    currentUser = null;
    allActivities = [];
    showLogin();
});

document.querySelectorAll("nav a[data-view]").forEach(link => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        if (link.dataset.view === "dashboard") loadDashboard();
        else if (link.dataset.view === "activities") loadActivities();
    });
});

init();
