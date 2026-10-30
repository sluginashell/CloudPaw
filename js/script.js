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
  const allPets = await getJson(`${CONFIG.API_BASE}/pets`);
  return allPets.find(p => String(p.id) === String(id)) || null;
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
/* ---------- Login Page Logic ---------- */
const loginForm = document.getElementById("login-form");

if (loginForm) {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault(); // Stops the page from refreshing

    // Grab the email they typed
    const email = document.getElementById("email").value;

    // For now, just show a success message and redirect them to the home page
    alert(`Login successful for ${email}! (Note: This is a simulated login until Safia connects AWS Cognito).`);

    // Send them to the home page
    window.location.href = "index.html";
  });
}