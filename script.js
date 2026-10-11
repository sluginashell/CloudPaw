/* =============================================================================
   CloudPaw — front-end controller
   Fetches pet listings from a configurable API endpoint.
   Locally: reads ./pets.json
   In AWS:  point API_BASE at your API Gateway invoke URL.
   ============================================================================= */

const CONFIG = {
  // Change this to your API Gateway URL after deploying the backend,
  // e.g. "https://abc123.execute-api.us-east-1.amazonaws.com/prod"
  API_BASE: "",
  USE_LOCAL_DATA: true, // flip to false after deploying
  LOCAL_DATA_URL: "./pets.json",
};

const els = {
  petList: document.getElementById("pet-list"),
  petStatus: document.getElementById("pet-status"),
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  navToggle: document.querySelector(".nav-toggle"),
  navLinks: document.getElementById("nav-menu"),
  year: document.getElementById("year"),
};

const PLACEHOLDER_IMAGE = "images/placeholder.svg";

/* ---------- Utilities ---------- */
const escapeHtml = (str = "") =>
  String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

const setStatus = (msg = "") => {
  if (els.petStatus) els.petStatus.textContent = msg;
};

const setBusy = (busy) => {
  if (!els.petList) return;
  els.petList.setAttribute("aria-busy", String(busy));
  if (busy) {
    els.petList.innerHTML = Array.from({ length: 6 })
      .map(() => `<div class="skeleton"></div>`)
      .join("");
  }
};

/* ---------- Data layer ---------- */
async function fetchPets(query = "") {
  const url = CONFIG.USE_LOCAL_DATA
    ? CONFIG.LOCAL_DATA_URL
    : `${CONFIG.API_BASE}/pets${query ? `?q=${encodeURIComponent(query)}` : ""}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load pets (${res.status})`);
  const pets = await res.json();

  // The API filters server-side; local JSON has to be filtered here.
  return CONFIG.USE_LOCAL_DATA ? filterPets(pets, query) : pets;
}

function filterPets(pets, query = "") {
  const q = query.toLowerCase();
  if (!q) return pets;
  return pets.filter((pet) =>
    [pet.name, pet.breed, pet.species, pet.location]
      .some((field) => String(field || "").toLowerCase().includes(q))
  );
}

const formatAge = (age) => {
  if (typeof age !== "number") return "Age unknown";
  if (age < 1) return "Under 1 yr";
  return `${age} ${age === 1 ? "yr" : "yrs"}`;
};

/* ---------- Rendering ---------- */
function renderPets(pets) {
  if (!Array.isArray(pets) || pets.length === 0) {
    els.petList.innerHTML = "";
    setStatus("No pets match your search. Try a different term.");
    return;
  }

  els.petList.innerHTML = pets
    .map(
      (pet) => `
      <article class="pet-card">
        <img
          class="pet-card__image"
          src="${escapeHtml(pet.image || PLACEHOLDER_IMAGE)}"
          alt="${escapeHtml(pet.name)} the ${escapeHtml(pet.species)}"
          loading="lazy"
        />
        <div class="pet-card__body">
          <h3 class="pet-card__name">${escapeHtml(pet.name)}</h3>
          <p class="pet-card__meta">
            ${escapeHtml(pet.species)} · ${escapeHtml(pet.breed || "Mixed")} · ${escapeHtml(formatAge(pet.age))}
          </p>
          <p class="pet-card__meta">${escapeHtml(pet.location || "")}</p>
          <button class="btn btn-primary pet-card__cta" type="button"
                  data-pet-id="${escapeHtml(String(pet.id))}">
            Meet ${escapeHtml(pet.name)}
          </button>
        </div>
      </article>`
    )
    .join("");

  setStatus(`Showing ${pets.length} ${pets.length === 1 ? "pet" : "pets"}.`);
}

/* ---------- Init ---------- */
async function loadPets(query = "") {
  setBusy(true);
  setStatus("Loading pets…");
  try {
    const pets = await fetchPets(query);
    renderPets(pets);
  } catch (err) {
    console.error(err);
    els.petList.innerHTML = "";
    setStatus("Sorry, we couldn't load pets right now. Please try again later.");
  } finally {
    setBusy(false);
  }
}

/* ---------- Events ---------- */
els.searchForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  loadPets(els.searchInput.value.trim());
});

els.petList?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pet-id]");
  if (!btn) return;
  // Wire this to your inquiry API later.
  alert(`Inquiry flow for pet #${btn.dataset.petId} coming soon.`);
});

// Swap in the placeholder when a pet photo is missing. Image errors don't
// bubble, so listen in the capture phase.
els.petList?.addEventListener(
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
loadPets();