
let currentUser = null;
let currentProfile = null; // { id, full_name, role }
let facilitiesCache = [];


(async function init() {
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "index.html";
    return;
  }
  currentUser = sessionData.session.user;

  const { data: profile, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (error || !profile) {
    alert("Could not load your profile. Please contact an administrator.");
    return;
  }
  currentProfile = profile;

  renderNav();
  renderUserChip();
  await loadFacilities();
  wireGlobalEvents();
  showView("facilities");
})();


function renderNav() {
  const nav = document.getElementById("nav-links");
  const links = [{ id: "facilities", label: "Facilities" }, { id: "reservations", label: "Reservations" }];

  if (currentProfile.role === "admin" || currentProfile.role === "staff") {
    links.push({ id: "service", label: "Service Concerns" });
  }
  if (currentProfile.role === "admin") {
    links.push({ id: "audit", label: "Audit Log" });
  }

  nav.innerHTML = links
    .map((l) => `<button class="nav-link" data-view="${l.id}">${l.label}</button>`)
    .join("");

  nav.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  if (currentProfile.role === "admin") {
    document.getElementById("btn-add-facility").classList.remove("hidden");
  }
}

function renderUserChip() {
  const roleLabel = { admin: "Administrator", staff: "Facility Staff", requester: "Requester" }[currentProfile.role];
  document.getElementById("user-chip").innerHTML =
    `<strong>${currentProfile.full_name}</strong><span class="role-badge role-${currentProfile.role}">${roleLabel}</span>`;
}

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((n) => n.classList.remove("active"));
  document.getElementById(`view-${id}`).classList.add("active");
  const navBtn = document.querySelector(`.nav-link[data-view="${id}"]`);
  if (navBtn) navBtn.classList.add("active");

  const titles = { facilities: "Facilities", reservations: "Reservations", service: "Service Concerns", audit: "Audit Log" };
  document.getElementById("page-title").textContent = titles[id];

  if (id === "reservations") loadReservations();
  if (id === "service") loadServiceRequests();
  if (id === "audit") loadAuditLog();
}


async function loadFacilities() {
  const { data, error } = await sb.from("facilities").select("*").order("name");
  if (error) return console.error(error);
  facilitiesCache = data;
  renderFacilities(data);
  populateFacilitySelects(data);
}

function renderFacilities(list) {
  const grid = document.getElementById("facilities-grid");
  grid.innerHTML = list
    .map(
      (f) => `
    <div class="facility-card">
      <div class="facility-card-top">
        <h3>${f.name}</h3>
        <span class="status-pill status-${f.status}">${f.status}</span>
      </div>
      <p class="muted">${f.description || ""}</p>
      <p class="fac-meta">${f.location || "—"} · Capacity: ${f.capacity ?? "—"}</p>
      ${
        f.status === "active" && currentProfile.role === "requester"
          ? `<button class="btn-secondary" onclick="openReservationModal('${f.id}')">Reserve</button>`
          : ""
      }
      ${
        currentProfile.role === "admin"
          ? `<div class="facility-admin-actions">
               <select onchange="updateFacilityStatus('${f.id}', this.value)">
                 <option value="active" ${f.status === "active" ? "selected" : ""}>Active</option>
                 <option value="maintenance" ${f.status === "maintenance" ? "selected" : ""}>Maintenance</option>
                 <option value="inactive" ${f.status === "inactive" ? "selected" : ""}>Inactive</option>
               </select>
             </div>`
          : ""
      }
    </div>`
    )
    .join("");
}

function populateFacilitySelects(list) {
  const activeOnly = list.filter((f) => f.status === "active");
  const opts = activeOnly.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  document.getElementById("res-facility").innerHTML = opts;
  document.getElementById("svc-facility").innerHTML = list.map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
}

async function updateFacilityStatus(id, status) {
  const { error } = await sb.from("facilities").update({ status }).eq("id", id);
  if (error) { alert(error.message); return; }
  await loadFacilities();
}

document.getElementById("btn-add-facility").addEventListener("click", () => {
  document.getElementById("modal-facility").showModal();
});

document.getElementById("form-facility").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById("fac-name").value,
    description: document.getElementById("fac-desc").value,
    location: document.getElementById("fac-location").value,
    capacity: Number(document.getElementById("fac-capacity").value) || null,
  };
  const { error } = await sb.from("facilities").insert(payload);
  const msg = document.getElementById("fac-msg");
  if (error) { msg.textContent = error.message; msg.className = "form-msg error"; return; }
  document.getElementById("modal-facility").close();
  e.target.reset();
  await loadFacilities();
});


function openReservationModal(facilityId) {
  document.getElementById("modal-reservation").showModal();
  if (facilityId) document.getElementById("res-facility").value = facilityId;
}

document.getElementById("form-reservation").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("res-msg");
  const payload = {
    facility_id: document.getElementById("res-facility").value,
    requester_id: currentUser.id,
    purpose: document.getElementById("res-purpose").value,
    start_time: new Date(document.getElementById("res-start").value).toISOString(),
    end_time: new Date(document.getElementById("res-end").value).toISOString(),
    status: "pending", // TC-B4-01: saved as Pending
  };

  const { error } = await sb.from("reservations").insert(payload);
  if (error) {
    
    msg.textContent = error.message;
    msg.className = "form-msg error";
    return;
  }
  document.getElementById("modal-reservation").close();
  e.target.reset();
  showView("reservations");
});

async function loadReservations() {
  const subtitle = document.getElementById("reservations-subtitle");
  let query = sb
    .from("reservations")
    .select("*, facilities(name), profiles!reservations_requester_id_fkey(full_name)")
    .order("start_time", { ascending: false });

  if (currentProfile.role === "requester") {
    subtitle.textContent = "Your reservation requests.";
    query = query.eq("requester_id", currentUser.id);
  } else {
    subtitle.textContent = "All reservation requests across facilities.";
  }

  const { data, error } = await query;
  if (error) return console.error(error);
  renderReservations(data);
}

function renderReservations(list) {
  const body = document.getElementById("reservations-body");
  body.innerHTML = list
    .map((r) => {
      const fmt = (d) => new Date(d).toLocaleString();
      return `
      <tr>
        <td>${r.facilities?.name ?? "—"}</td>
        <td>${r.purpose}</td>
        <td>${fmt(r.start_time)}</td>
        <td>${fmt(r.end_time)}</td>
        <td><span class="status-pill status-${r.status}">${r.status}</span></td>
        <td>${reservationActions(r)}</td>
      </tr>`;
    })
    .join("");
}

function reservationActions(r) {
  const actions = [];

  if (currentProfile.role === "admin" && r.status === "pending") {
    actions.push(`<button class="btn-tiny approve" onclick="reviewReservation('${r.id}','approved')">Approve</button>`);
    actions.push(`<button class="btn-tiny reject" onclick="reviewReservation('${r.id}','rejected')">Reject</button>`);
  }


  if (currentProfile.role === "staff" && r.status === "scheduled") {
    actions.push(`<button class="btn-tiny" onclick="setReservationStatus('${r.id}','in_use')">Mark In Use</button>`);
  }
  if (currentProfile.role === "staff" && r.status === "in_use") {
    actions.push(`<button class="btn-tiny" onclick="setReservationStatus('${r.id}','completed')">Complete</button>`);
  }

 
  if (currentProfile.role === "requester" && r.status === "pending" && r.requester_id === currentUser.id) {
    actions.push(`<button class="btn-tiny reject" onclick="setReservationStatus('${r.id}','cancelled')">Cancel</button>`);
  }

  return actions.join(" ") || "—";
}

async function reviewReservation(id, decision) {
  const { error } = await sb
    .from("reservations")
    .update({ status: decision, reviewed_by: currentUser.id })
    .eq("id", id);
  if (error) { alert(error.message); return; }
  await loadReservations();
}

async function setReservationStatus(id, status) {
  const { error } = await sb.from("reservations").update({ status }).eq("id", id);
  if (error) { alert(error.message); return; }
  await loadReservations();
}


document.getElementById("btn-add-service").addEventListener("click", () => {
  document.getElementById("modal-service").showModal();
});

document.getElementById("form-service").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("svc-msg");
  const payload = {
    facility_id: document.getElementById("svc-facility").value,
    staff_id: currentUser.id,
    description: document.getElementById("svc-desc").value,
  };
  const { error } = await sb.from("service_requests").insert(payload);
  if (error) { msg.textContent = error.message; msg.className = "form-msg error"; return; }
  document.getElementById("modal-service").close();
  e.target.reset();
  await loadServiceRequests();
});

async function loadServiceRequests() {
  const { data, error } = await sb
    .from("service_requests")
    .select("*, facilities(name)")
    .order("created_at", { ascending: false });
  if (error) return console.error(error);
  document.getElementById("service-body").innerHTML = data
    .map(
      (s) => `<tr>
        <td>${s.facilities?.name ?? "—"}</td>
        <td>${s.description}</td>
        <td><span class="status-pill status-${s.status}">${s.status}</span></td>
        <td>${new Date(s.created_at).toLocaleString()}</td>
      </tr>`
    )
    .join("");
}

async function loadAuditLog() {
  const { data, error } = await sb
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return console.error(error);
  document.getElementById("audit-body").innerHTML = data
    .map(
      (a) => `<tr>
        <td>${new Date(a.created_at).toLocaleString()}</td>
        <td>${a.action}</td>
        <td>${a.entity_type}${a.entity_id ? " · " + a.entity_id.slice(0, 8) : ""}</td>
        <td><code class="details">${JSON.stringify(a.details ?? {})}</code></td>
      </tr>`
    )
    .join("");
}


function wireGlobalEvents() {
  document.querySelectorAll("dialog [data-close]").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("dialog").close());
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "index.html";
  });
}
