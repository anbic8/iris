const API = "/api";
let currentUser = null;

// --- HTTP helper ---
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

// --- Routing ---
async function init() {
    try {
        currentUser = await request("GET", "/users/me");
        showMain();
    } catch {
        showLogin();
    }
}

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

// --- Dashboard ---
async function loadDashboard() {
    const content = document.getElementById("content");
    content.innerHTML = "<p>Lade…</p>";
    try {
        const activities = await request("GET", "/activities/");
        const totalKm = activities.reduce((s, a) => s + (a.distance_m / 1000), 0);
        const totalTime = activities.reduce((s, a) => s + a.duration_s, 0);
        const totalEle = activities.reduce((s, a) => s + (a.elevation_gain_m || 0), 0);

        content.innerHTML = `
            <h2>Dashboard</h2>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${activities.length}</div><div class="stat-label">Aktivitäten</div></div>
                <div class="stat-card"><div class="stat-value">${totalKm.toFixed(1)}</div><div class="stat-label">km gesamt</div></div>
                <div class="stat-card"><div class="stat-value">${fmtDuration(totalTime)}</div><div class="stat-label">Gesamtzeit</div></div>
                <div class="stat-card"><div class="stat-value">${Math.round(totalEle)}</div><div class="stat-label">Höhenmeter</div></div>
            </div>
            <h3>Letzte Aktivitäten</h3>
            <div class="activity-list">${activities.slice(0, 10).map(activityCard).join("")}</div>
        `;
        document.querySelectorAll(".activity-card").forEach(el => {
            el.addEventListener("click", () => loadActivity(parseInt(el.dataset.id)));
        });
    } catch (e) {
        content.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

// --- Activity list ---
async function loadActivities() {
    const content = document.getElementById("content");
    content.innerHTML = "<p>Lade…</p>";
    try {
        const activities = await request("GET", "/activities/");
        content.innerHTML = `
            <h2>Alle Aktivitäten (${activities.length})</h2>
            <div class="activity-list">${activities.map(activityCard).join("")}</div>
        `;
        document.querySelectorAll(".activity-card").forEach(el => {
            el.addEventListener("click", () => loadActivity(parseInt(el.dataset.id)));
        });
    } catch (e) {
        content.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

// --- Single activity ---
async function loadActivity(id) {
    const content = document.getElementById("content");
    content.innerHTML = "<p>Lade…</p>";
    try {
        const [activity, trackpoints] = await Promise.all([
            request("GET", `/activities/${id}`),
            request("GET", `/activities/${id}/trackpoints`),
        ]);
        content.innerHTML = `
            <h2>${sportLabel(activity.sport_type)} ${fmtDate(activity.start_time)}</h2>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${(activity.distance_m / 1000).toFixed(2)}</div><div class="stat-label">km</div></div>
                <div class="stat-card"><div class="stat-value">${fmtDuration(activity.duration_s)}</div><div class="stat-label">Zeit</div></div>
                ${activity.avg_pace ? `<div class="stat-card"><div class="stat-value">${fmtPace(activity.avg_pace)}</div><div class="stat-label">Ø Pace</div></div>` : ""}
                ${activity.avg_hr ? `<div class="stat-card"><div class="stat-value">${activity.avg_hr}</div><div class="stat-label">Ø HR bpm</div></div>` : ""}
                ${activity.elevation_gain_m ? `<div class="stat-card"><div class="stat-value">${Math.round(activity.elevation_gain_m)}</div><div class="stat-label">Höhenmeter</div></div>` : ""}
            </div>
            <div id="map"></div>
        `;
        if (trackpoints.length > 0) {
            renderMap(trackpoints);
        }
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

// --- Helpers ---
function activityCard(a) {
    return `<div class="activity-card" data-id="${a.id}">
        <span class="act-sport">${sportLabel(a.sport_type)}</span>
        <div class="act-info">
            <div class="act-title">${fmtDate(a.start_time)}</div>
            <div class="act-meta">${(a.distance_m / 1000).toFixed(2)} km · ${fmtDuration(a.duration_s)}${a.avg_pace ? " · " + fmtPace(a.avg_pace) + "/km" : ""}${a.avg_hr ? " · ♥ " + a.avg_hr : ""}</div>
        </div>
    </div>`;
}

function sportLabel(type) {
    return { running: "🏃", cycling: "🚴", hiking: "🥾", other: "🏅" }[type] ?? "🏅";
}

function fmtDate(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDuration(seconds) {
    if (!seconds) return "–";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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
        showMain();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
    }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
    await request("POST", "/users/logout").catch(() => {});
    currentUser = null;
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
