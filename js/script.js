/* =============================================================================
   CloudPaw — front-end controller (shared by every page)
   Fetches pet listings from a configurable API endpoint.
   Locally: reads ./data/pets.json
   In AWS:  point API_BASE at your API Gateway invoke URL.

   Each page sets <body data-page="..."> and the matching init function below
   runs: home, pets, pet, adopt, about.
   ============================================================================= */

const CONFIG = {
  API_BASE: "http://localhost:3000",
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

// Sends form data to the API. There is no backend yet, so in local mode the
// data is only logged to the console; nothing is stored or emailed.
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
  if (!res.ok) throw new Error(`Submit failed (${res.status})`);
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
    input.insertAdjacentElement("afterend", el);
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
// API on the page, and on success saves the session and goes to the home page.
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
        setStatus(`Welcome, ${body.user.name}! Taking you to the home page…`);
        window.location.href = "index.html";
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
function wireForm({ form, path, successEl, statusEl, onSuccess }) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    const submitBtn = form.querySelector("[type=submit]");
    submitBtn.disabled = true;
    statusEl.textContent = "Sending…";

    try {
      await submitForm(path, data);
      onSuccess?.(data);
      form.hidden = true;
      successEl.hidden = false;
      successEl.focus();
      statusEl.textContent = "";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Sorry, something went wrong. Please try again.";
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

/* ---------- Boot ---------- */
pages[document.body.dataset.page]?.();