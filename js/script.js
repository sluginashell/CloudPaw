/* =============================================================================
   CloudPaw — front-end controller (shared by every page)
   Fetches pet listings from a configurable API endpoint.
   API_BASE is relative ("/api") because backend/server.js serves both this
   site and the API from http://localhost:3000.
   In AWS:  point API_BASE at your API Gateway invoke URL.

   Each page sets <body data-page="..."> and the matching init function below
   runs: home, pets, pet, adopt, about.
   ============================================================================= */

const CONFIG = {
  API_BASE: "/api",
  USE_LOCAL_DATA: false,
  LOCAL_DATA_URL: "./data/pets.json",
};

const PLACEHOLDER_IMAGE = "images/placeholder.svg";

const els = {
  navToggle: document.querySelector(".nav-toggle"),
  navLinks: document.getElementById("nav-menu"),
  year: document.getElementById("year"),
};

/* ---------- Utilities ---------- */
const escapeHtml = (str = "") =>
  String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

const formatAge = (age) => {
  if (typeof age !== "number") return "Age unknown";
  if (age < 1) return "Under 1 yr";
  return `${age} ${age === 1 ? "yr" : "yrs"}`;
};

const getParam = (name) => new URLSearchParams(window.location.search).get(name) || "";

function filterPets(pets, query = "") {
  const q = query.toLowerCase();
  if (!q) return pets;
  return pets.filter((pet) =>
    [pet.name, pet.breed, pet.species, pet.location]
      .some((field) => String(field || "").toLowerCase().includes(q))
  );
}

/* ---------- Data layer ---------- */
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.json();
}

async function fetchPets(query = "") {
  if (CONFIG.USE_LOCAL_DATA) {
    // The API filters server-side; local JSON has to be filtered here.
    return filterPets(await getJson(CONFIG.LOCAL_DATA_URL), query);
  }
  return getJson(`${CONFIG.API_BASE}/pets${query ? `?q=${encodeURIComponent(query)}` : ""}`);
}

async function fetchPet(id) {
  if (CONFIG.USE_LOCAL_DATA) {
    const pets = await getJson(CONFIG.LOCAL_DATA_URL);
    return pets.find((pet) => String(pet.id) === String(id)) || null;
  }
  const res = await fetch(`${CONFIG.API_BASE}/pets/${encodeURIComponent(id)}`);
  // 404 means "no such pet": return null so the page shows "couldn't find that pet".
  // Any other failure throws, so the page shows "couldn't load this pet right now".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Request failed (${res.status}): /pets/${id}`);
  return res.json();
}

// Sends form data to the API. In local mode the data is only logged to the
// console; nothing is stored or emailed.
// On an error response it throws an Error that also carries the API's reply:
// err.status, err.apiMessage (the API's "error" text) and err.fields
// ({ field: message } for each invalid field, empty if none).
async function submitForm(path, data) {
  if (CONFIG.USE_LOCAL_DATA) {
    console.info(`[local mode] POST ${path} was not sent:`, data);
    return;
  }
  const res = await fetch(`${CONFIG.API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(`Submit failed (${res.status}): ${path}`);
    err.status = res.status;
    err.apiMessage = typeof body.error === "string" ? body.error : "";
    err.fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    throw err;
  }
}

/* ---------- Auth ---------- */
// Sign-in state from /auth/login or /auth/signup: { token, user }.
// Later requests that need sign-in send it as "Authorization: Bearer <token>".
const AUTH_STORAGE_KEY = "cloudpaw.auth";

// Returns false if the browser blocks storage (e.g. some private modes).
function saveAuth(token, user) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, user }));
    return true;
  } catch {
    return false;
  }
}

// The saved sign-in, { token, user }, or null when signed out (or storage is blocked).
function getAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    return auth && typeof auth.token === "string" && auth.user ? auth : null;
  } catch {
    return null;
  }
}

function clearAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was saved, so nothing to clear.
  }
}

// Header for API routes that need sign-in. Empty when signed out.
function authHeaders() {
  const auth = getAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
}

const isAdmin = () => getAuth()?.user.role === "admin";

// Ends the session on the server, forgets it here, and goes to the home page.
// The token is cleared even if the server can't be reached.
async function signOut() {
  const headers = authHeaders();
  clearAuth();
  try {
    await fetch(`${CONFIG.API_BASE}/auth/logout`, { method: "POST", headers });
  } catch (err) {
    console.error(err);
  }
  window.location.href = "index.html";
}

// Asks the API who the saved token belongs to and updates the saved user
// (e.g. a changed role). Returns the user, or null when signed out or the
// session has expired (the stale token is then cleared). If the API can't be
// reached, keeps the saved user rather than signing anyone out.
async function refreshAuth() {
  const auth = getAuth();
  if (!auth || CONFIG.USE_LOCAL_DATA) return auth?.user || null;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/me`, { headers: authHeaders() });
    if (res.status === 401) {
      clearAuth();
      return null;
    }
    if (!res.ok) return auth.user;
    const { user } = await res.json();
    saveAuth(auth.token, user);
    return user;
  } catch {
    return auth.user;
  }
}

// Checked once per page load; the nav and admin pages share the result.
let authCheck;
const checkAuth = () => (authCheck ??= refreshAuth());

// Sends the browser to the sign-in page, coming back to this page afterwards.
function goToSignIn() {
  const here = window.location.pathname.split("/").pop() || "index.html";
  window.location.replace(`login.html?next=${encodeURIComponent(here)}`);
}

// For admin pages: shows the page to a signed-in admin and returns true.
// Anyone else is sent to the sign-in page and it returns false.
// (This only hides the page; the API itself refuses non-admins.)
async function requireAdminPage() {
  await checkAuth();
  if (!isAdmin()) {
    goToSignIn();
    return false;
  }
  document.getElementById("main").hidden = false;
  return true;
}

// Where to go after signing in: ?next=<page>.html if given, else the home page.
// Only plain page names are accepted, so the link can't send people off-site.
function pageAfterSignIn() {
  const next = getParam("next");
  return /^[\w-]+\.html$/.test(next) ? next : "index.html";
}

// Nav: "Sign In", or "Hi, Name · Sign out"; admin links only for admins.
function renderAuthNav() {
  const user = getAuth()?.user;
  const admin = isAdmin();
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.hidden = !admin;
  });
  document.querySelectorAll("[data-auth-nav]").forEach((slot) => {
    slot.innerHTML = user
      ? `<span class="nav-greeting">Hi, ${escapeHtml(user.name)}</span>
         <span aria-hidden="true">·</span>
         <button type="button" class="btn btn-ghost" data-action="sign-out">Sign out</button>`
      : `<a href="login.html" class="btn btn-ghost">Sign In</a>`;
  });
}

// POSTs JSON to an /auth route. Resolves with { ok, body } for any HTTP
// response; only throws if the server can't be reached.
async function postAuth(path, data) {
  const res = await fetch(`${CONFIG.API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

// Shows a message under a form field and marks the field invalid.
function showFieldError(input, message) {
  const id = `${input.id}-error`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("p");
    el.id = id;
    el.className = "field-error";
    // A checkbox sits beside its label, so put its message below both.
    if (input.type === "checkbox" && input.parentElement) input.parentElement.append(el);
    else input.insertAdjacentElement("afterend", el);
  }
  el.textContent = message;
  input.setAttribute("aria-invalid", "true");
  input.dataset.prevDescribedby ??= input.getAttribute("aria-describedby") || "";
  input.setAttribute("aria-describedby", `${input.dataset.prevDescribedby} ${id}`.trim());
}

function clearFieldErrors(form) {
  form.querySelectorAll(".field-error").forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
    input.removeAttribute("aria-invalid");
    const prev = input.dataset.prevDescribedby;
    if (prev) input.setAttribute("aria-describedby", prev);
    else input.removeAttribute("aria-describedby");
    delete input.dataset.prevDescribedby;
  });
}

// Wires the sign-in or sign-up form: checks it, posts it, shows errors from the
// API on the page, and on success saves the session and goes to the page in
// ?next= (e.g. an admin page that sent them here), or else the home page.
function wireAuthForm({ form, statusEl, path, buildBody, beforeSubmit, onFailure, pendingText }) {
  const setStatus = (message, isError = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle("status--error", isError);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    setStatus("");
    beforeSubmit?.();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (CONFIG.USE_LOCAL_DATA) {
      setStatus("Signing in needs the CloudPaw API, which isn't connected in local mode.", true);
      return;
    }

    const submitBtn = form.querySelector("[type=submit]");
    submitBtn.disabled = true;
    setStatus(pendingText);

    try {
      const { ok, body } = await postAuth(path, buildBody());
      if (ok && body.token && body.user) {
        if (!saveAuth(body.token, body.user)) {
          setStatus("Your browser is blocking site storage, so we can't keep you signed in.", true);
          return;
        }
        setStatus(`Welcome, ${body.user.name}!`);
        window.location.href = pageAfterSignIn();
        return;
      }

      // 400 / 401 / 409: show the API's message, plus any per-field messages.
      for (const [field, message] of Object.entries(body.fields || {})) {
        const input = form.elements[field];
        if (input) showFieldError(input, message);
      }
      setStatus(body.error || "Something went wrong. Please try again.", true);
      onFailure?.();
      form.querySelector('[aria-invalid="true"]')?.focus();
    } catch (err) {
      console.error(err);
      setStatus("We couldn't reach the server. Please try again later.", true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Rendering ---------- */
const petCardHtml = (pet) => `
  <article class="pet-card">
    <img
      class="pet-card__image"
      src="${escapeHtml(pet.photo_url || 'images/pets/' + pet.name.toLowerCase() + '.jpg')}"
      alt="${escapeHtml(pet.name)} the ${escapeHtml(pet.species)}"
      loading="lazy"
    />
    <div class="pet-card__body">
      <h3 class="pet-card__name">${escapeHtml(pet.name)}</h3>
      <p class="pet-card__meta">
        ${escapeHtml(pet.species)} · ${escapeHtml(pet.breed || "Mixed")} · ${escapeHtml(formatAge(pet.age))}
      </p>
      <p class="pet-card__meta">${escapeHtml(pet.location || "")}</p>
      <a class="btn btn-primary pet-card__cta"
         href="pet.html?id=${encodeURIComponent(pet.id)}">
        Meet ${escapeHtml(pet.name)}
      </a>
    </div>
  </article>`;

const petDetailHtml = (pet) => `
  <article class="pet-detail">
    <img
      class="pet-detail__image"
      src="${escapeHtml(pet.photo_url ? pet.photo_url : 'images/pets/' + pet.name.toLowerCase() + '.jpg')}"
      alt="${escapeHtml(pet.name)} the ${escapeHtml(pet.species)}"
    />
    <div class="pet-detail__body">
      <p class="eyebrow">${escapeHtml(pet.species)} · ${escapeHtml(pet.breed || "Mixed")}</p>
      <h1>${escapeHtml(pet.name)}</h1>
      <dl class="facts">
        <div><dt>Age</dt><dd>${escapeHtml(formatAge(pet.age))}</dd></div>
        <div><dt>Sex</dt><dd>${escapeHtml(pet.sex || "Unknown")}</dd></div>
        <div><dt>Breed</dt><dd>${escapeHtml(pet.breed || "Mixed")}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml(pet.location || "Unknown")}</dd></div>
      </dl>
      <p>${escapeHtml(pet.description || `${pet.name} is waiting for a loving home.`)}</p>
      <a class="btn btn-primary" href="adopt.html?pet=${encodeURIComponent(pet.id)}">
        Apply to adopt ${escapeHtml(pet.name)}
      </a>
      <a class="back-link" href="pets.html">← Back to all pets</a>
    </div>
  </article>`;

// One row on admin-applications.html, from GET /api/inquiries. Every value
// comes from a public form, so all of it is escaped.
// Statuses with their own badge color in style.css (.badge--pending, …).
const STATUS_BADGES = ["pending", "approved", "denied"];
const applicationRowHtml = (app) => {
  const status = String(app.status || "pending").toLowerCase();
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const badge = STATUS_BADGES.includes(status) ? `badge--${status}` : "";
  // Approve/Deny only show an alert for now; nothing is saved yet.
  const actions = status === "pending"
    ? `<button type="button" class="btn-small btn-small--approve" onclick="alert('Application Approved!')">Approve</button>
       <button type="button" class="btn-small btn-small--deny" onclick="alert('Application Denied.')">Deny</button>`
    : `<span class="muted">Completed</span>`;
  return `
    <tr>
      <td>${escapeHtml(app.name)}</td>
      <td class="data-table__strong">${escapeHtml(app.pet_name || `Pet #${app.pet_id}`)}</td>
      <td class="muted">${escapeHtml(app.email)}</td>
      <td><span class="badge ${badge}">${escapeHtml(label)}</span></td>
      <td class="data-table__actions">${actions}</td>
    </tr>`;
};

const skeletons = (count) =>
  Array.from({ length: count }).map(() => `<div class="skeleton"></div>`).join("");

// Loads pets into a grid. Used by the home page (featured) and pets.html (all).
async function loadPetGrid({ listEl, statusEl, query = "", species = "", limit = 0 }) {
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  listEl.setAttribute("aria-busy", "true");
  listEl.innerHTML = skeletons(limit || 6);
  setStatus("Loading pets…");

  try {
    let pets = await fetchPets(query);
    if (species) pets = pets.filter((pet) => pet.species === species);
    if (limit) pets = pets.slice(0, limit);

    if (pets.length === 0) {
      listEl.innerHTML = "";
      setStatus("No pets match your search. Try a different term.");
      return;
    }

    listEl.innerHTML = pets.map(petCardHtml).join("");
    setStatus(limit ? "" : `Showing ${pets.length} ${pets.length === 1 ? "pet" : "pets"}.`);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = "";
    setStatus("Sorry, we couldn't load pets right now. Please try again later.");
  } finally {
    listEl.setAttribute("aria-busy", "false");
  }
}

// Validates a form, sends it, then swaps the form for a thank-you message.
// If the API rejects it, shows the API's message and puts each field's
// message under that field.
function wireForm({ form, path, successEl, statusEl, onSuccess }) {
  const setStatus = (message, isError = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle("status--error", isError);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    setStatus("");
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    const submitBtn = form.querySelector("[type=submit]");
    submitBtn.disabled = true;
    setStatus("Sending…");

    try {
      await submitForm(path, data);
      onSuccess?.(data);
      form.hidden = true;
      successEl.hidden = false;
      successEl.focus();
      setStatus("");
    } catch (err) {
      console.error(err);
      for (const [field, message] of Object.entries(err.fields || {})) {
        const input = form.elements[field];
        if (input) showFieldError(input, message);
      }
      // No status means the request never got an answer (offline, server down).
      setStatus(
        err.apiMessage ||
          (err.status ? "Sorry, something went wrong. Please try again." : "We couldn't reach the server. Please try again later."),
        true
      );
      form.querySelector('[aria-invalid="true"]')?.focus();
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Pages ---------- */
const pages = {
  home() {
    const listEl = document.getElementById("pet-list");
    loadPetGrid({
      listEl,
      statusEl: document.getElementById("pet-status"),
      limit: Number(listEl.dataset.limit) || 0,
    });
  },

  pets() {
    const query = getParam("q").trim();
    const species = getParam("species");
    document.getElementById("search-input").value = query;
    document.getElementById("species-select").value = species;

    loadPetGrid({
      listEl: document.getElementById("pet-list"),
      statusEl: document.getElementById("pet-status"),
      query,
      species,
    });
  },

  async pet() {
    const container = document.getElementById("pet-detail");
    const statusEl = document.getElementById("pet-status");
    const id = getParam("id");

    try {
      const pet = id ? await fetchPet(id) : null;
      if (!pet) {
        container.innerHTML = "";
        statusEl.innerHTML = `We couldn't find that pet. <a class="back-link" href="pets.html">Browse all pets</a>`;
        return;
      }
      document.title = `${pet.name} | CloudPaw`;
      container.innerHTML = petDetailHtml(pet);
      statusEl.textContent = "";
    } catch (err) {
      console.error(err);
      container.innerHTML = "";
      statusEl.textContent = "Sorry, we couldn't load this pet right now. Please try again later.";
    } finally {
      container.setAttribute("aria-busy", "false");
    }
  },

  async adopt() {
    const form = document.getElementById("adopt-form");
    const select = document.getElementById("adopt-pet");
    const wantedId = getParam("pet");

    try {
      const pets = await fetchPets();
      select.insertAdjacentHTML(
        "beforeend",
        pets
          .map((pet) => `<option value="${escapeHtml(String(pet.id))}">${escapeHtml(pet.name)} (${escapeHtml(pet.species)}, ${escapeHtml(pet.breed || "Mixed")})</option>`)
          .join("")
      );
      if (wantedId) select.value = wantedId;
    } catch (err) {
      console.error(err);
      document.getElementById("adopt-status").textContent =
        "We couldn't load the pet list. Please refresh the page.";
    }

    wireForm({
      form,
      path: "/inquiries",
      successEl: document.getElementById("adopt-success"),
      statusEl: document.getElementById("adopt-status"),
      onSuccess: () => {
        const petName = select.options[select.selectedIndex]?.text.split(" (")[0] || "your pet";
        document.getElementById("adopt-success-pet").textContent = petName;
      },
    });
  },

  about() {
    wireForm({
      form: document.getElementById("contact-form"),
      path: "/messages",
      successEl: document.getElementById("contact-success"),
      statusEl: document.getElementById("contact-status"),
    });
  },

  login() {
    const form = document.getElementById("login-form");
    // Sent here by an admin page (see goToSignIn).
    if (getParam("next")) {
      document.getElementById("login-status").textContent = getAuth()
        ? "That page is for admins only. Sign in with an admin account to continue."
        : "Please sign in to continue.";
    }
    wireAuthForm({
      form,
      statusEl: document.getElementById("login-status"),
      path: "/auth/login",
      pendingText: "Signing in…",
      buildBody: () => ({ email: form.elements.email.value, password: form.elements.password.value }),
      // Wrong email or password: clear the password so it can be retyped.
      onFailure: () => {
        form.elements.password.value = "";
        form.elements.password.focus();
      },
    });
  },

  signup() {
    const form = document.getElementById("signup-form");
    const password = form.elements.password;
    const confirm = form.elements["confirm-password"];

    // The confirm field is checked here only; it is never sent to the API.
    const checkMatch = () =>
      confirm.setCustomValidity(confirm.value && confirm.value !== password.value ? "Passwords don't match." : "");
    password.addEventListener("input", checkMatch);
    confirm.addEventListener("input", checkMatch);

    wireAuthForm({
      form,
      statusEl: document.getElementById("signup-status"),
      path: "/auth/signup",
      pendingText: "Creating your account…",
      beforeSubmit: checkMatch,
      buildBody: () => ({
        name: form.elements.name.value,
        email: form.elements.email.value,
        password: password.value,
      }),
    });
  },

  // Admin: add a pet with POST /api/pets.
  async "admin-add"() {
    if (!(await requireAdminPage())) return;
    const form = document.getElementById("add-pet-form");
    const statusEl = document.getElementById("add-pet-status");
    const submitBtn = form.querySelector("[type=submit]");
    const setStatus = (message, isError = false) => {
      statusEl.textContent = message;
      statusEl.classList.toggle("status--error", isError);
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      setStatus("");
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // Named fields only: name, species, breed, age, location, description.
      // (The photo input has no name yet; uploads aren't supported by the API.)
      const data = Object.fromEntries(new FormData(form));
      submitBtn.disabled = true;
      setStatus("Saving…");

      try {
        const res = await fetch(`${CONFIG.API_BASE}/pets`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(data),
        });
        const body = await res.json().catch(() => ({}));

        if (res.status === 401 || res.status === 403) {
          // Session expired or no longer an admin: sign in again.
          if (res.status === 401) clearAuth();
          goToSignIn();
          return;
        }
        if (res.ok) {
          form.reset();
          statusEl.classList.remove("status--error");
          statusEl.innerHTML = `${escapeHtml(body.name)} was added. <a href="pet.html?id=${encodeURIComponent(body.id)}">View their page</a>`;
          return;
        }

        // 400: show each field's message under that field.
        for (const [field, message] of Object.entries(body.fields || {})) {
          const input = form.elements[field];
          if (input) showFieldError(input, message);
        }
        setStatus(body.error || "Could not save the pet. Please try again.", true);
        form.querySelector('[aria-invalid="true"]')?.focus();
      } catch (err) {
        console.error(err);
        setStatus("We couldn't reach the server. Please try again later.", true);
      } finally {
        submitBtn.disabled = false;
      }
    });
  },

  // Admin: list adoption applications from GET /api/inquiries.
  async "admin-applications"() {
    if (!(await requireAdminPage())) return;
    const tbody = document.getElementById("applications-table");
    const statusEl = document.getElementById("applications-status");
    statusEl.textContent = "Loading applications…";

    try {
      const res = await fetch(`${CONFIG.API_BASE}/inquiries`, { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) {
        if (res.status === 401) clearAuth();
        goToSignIn();
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status}): /inquiries`);

      const apps = await res.json();
      tbody.innerHTML = apps.map(applicationRowHtml).join("");
      statusEl.textContent = apps.length
        ? `${apps.length} ${apps.length === 1 ? "application" : "applications"}.`
        : "No applications yet.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Sorry, we couldn't load applications right now. Please try again later.";
      statusEl.classList.add("status--error");
    }
  },
};

/* ---------- Shared events ---------- */
// Swap in the placeholder when a pet photo is missing. Image errors don't
// bubble, so listen in the capture phase.
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || img.src.endsWith(PLACEHOLDER_IMAGE)) return;
    img.src = PLACEHOLDER_IMAGE;
  },
  true
);

els.navToggle?.addEventListener("click", () => {
  const open = els.navLinks.classList.toggle("is-open");
  els.navToggle.setAttribute("aria-expanded", String(open));
});

/* ---------- Footer year ---------- */
if (els.year) els.year.textContent = new Date().getFullYear();

// "Sign out" in the nav (rendered by renderAuthNav).
document.addEventListener("click", (e) => {
  if (e.target.closest('[data-action="sign-out"]')) signOut();
});

/* ---------- Boot ---------- */
// Draw the nav from the saved sign-in right away, then again once the API has
// confirmed it (an expired session switches back to "Sign In").
renderAuthNav();
checkAuth().then(renderAuthNav);
pages[document.body.dataset.page]?.();