// World Clocks — digital + analog per timezone (with full IANA list & map integration)
//
// - Uses Intl.supportedValuesOf('timeZone') when available for a full IANA list.
// - Fallback: tries to fetch a public timezones.json as a backup.
// - Map integration: Leaflet map (already referenced in clock.html).
//   Click map => reverse geocode via Nominatim => timezone lookup via timeapi.io
// - Geolocation: center map to user location and suggest timezone.
// - Adds selected timezone to state and persists in localStorage.
//
// NOTE: This file expects clock.html to include Leaflet CSS/JS and an element with id="map".
// Make sure clock.html includes:
//   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
//   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
//
// You may want to host a copy of timezones.json locally if you prefer not to rely on the remote URL.

const STORAGE_KEY = 'soloLeveling_world_clocks_v1';
const DEFAULT_ZONES = [
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Tokyo'
];

// Public fallback timezone list JSON raw URL (used only if Intl.supportedValuesOf not available)
const TIMEZONES_JSON_URL = 'https://raw.githubusercontent.com/dmfilipenko/timezones.json/master/timezones.json';
// Timezone lookup by coordinates (free endpoint). Format used: https://timeapi.io/api/TimeZone/coordinate?latitude=...&longitude=...
const TIMEZONE_BY_COORD_URL = 'https://timeapi.io/api/TimeZone/coordinate';

const COMMON_TIMEZONES = [
  "UTC","Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid","Europe/Rome",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Sao_Paulo",
  "Asia/Tokyo","Asia/Shanghai","Asia/Hong_Kong","Asia/Kolkata","Asia/Singapore",
  "Australia/Sydney","Pacific/Auckland","Africa/Johannesburg","America/Argentina/Buenos_Aires"
];

// Elements
const els = {
  tzInput: document.getElementById('tz-input'),
  tzList: document.getElementById('tz-list'),
  addBtn: document.getElementById('add-tz'),
  clocksContainer: document.getElementById('clocks'),
  toggleAnalog: document.getElementById('toggle-analog'),
  toggle12h: document.getElementById('toggle-12h'),
  resetBtn: document.getElementById('reset-default'),
  mapElement: document.getElementById('map')
};

let state = {
  zones: [],
  analog: false,
  hour12: false
};

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.zones = Array.isArray(parsed.zones) ? parsed.zones : DEFAULT_ZONES.slice();
      state.analog = !!parsed.analog;
      state.hour12 = !!parsed.hour12;
    } else {
      state.zones = DEFAULT_ZONES.slice();
      state.analog = false;
      state.hour12 = false;
    }
  } catch (e) {
    state.zones = DEFAULT_ZONES.slice();
    state.analog = false;
    state.hour12 = false;
  }
}

// Populate datalist using best available source
async function buildTimezoneDatalist() {
  // Clear existing
  els.tzList.innerHTML = '';

  // 1) Preferred: Intl.supportedValuesOf('timeZone')
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      const tzs = Intl.supportedValuesOf('timeZone');
      tzs.forEach(tz => {
        const opt = document.createElement('option');
        opt.value = tz;
        els.tzList.appendChild(opt);
      });
      return;
    } catch (e) {
      // fall back to fetch
      console.warn('Intl.supportedValuesOf failed, falling back to fetch list', e);
    }
  }

  // 2) Try fetching a public timezones.json (fallback)
  try {
    const resp = await fetch(TIMEZONES_JSON_URL);
    if (resp.ok) {
      const data = await resp.json();
      let tzlist = [];
      if (Array.isArray(data)) {
        if (data.length > 0 && typeof data[0] === 'string') {
          tzlist = data;
        } else if (data.length > 0 && data[0].hasOwnProperty('value')) {
          tzlist = data.map(x => x.value).filter(Boolean);
        } else if (data.length > 0 && data[0].hasOwnProperty('tzid')) {
          tzlist = data.map(x => x.tzid).filter(Boolean);
        } else {
          tzlist = data.flatMap(d => (typeof d === 'string' ? d : Object.values(d))).filter(Boolean);
        }
      }
      tzlist.forEach(tz => {
        const opt = document.createElement('option');
        opt.value = tz;
        els.tzList.appendChild(opt);
      });
      return;
    }
    console.warn('Fetching timezones.json returned non-ok status', resp.status);
  } catch (e) {
    console.warn('Fetching timezones.json failed, falling back to COMMON_TIMEZONES', e);
  }

  // 3) Last fallback: small common list
  COMMON_TIMEZONES.forEach(tz => {
    const opt = document.createElement('option');
    opt.value = tz;
    els.tzList.appendChild(opt);
  });
}

// Helpers
function tzLabel(tz) {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ');
}

function createClockCard(tz) {
  const card = document.createElement('section');
  card.className = 'clock-card';
  card.dataset.timezone = tz;

  const analogWrap = document.createElement('div');
  analogWrap.className = 'analog-wrap';
  analogWrap.innerHTML = `
    <div class="analog" aria-hidden="true">
      <div class="hand hour" data-hand="hour"></div>
      <div class="hand minute" data-hand="minute"></div>
      <div class="hand second" data-hand="second"></div>
      <div class="center-dot"></div>
    </div>
  `;

  const info = document.createElement('div');
  info.className = 'clock-info';
  info.innerHTML = `
    <div class="tz-name">${tzLabel(tz)}</div>
    <div class="local-name small-muted" data-localname></div>
    <div class="time-digital" data-time>--:--:--</div>
    <div class="small-muted" data-date>—</div>
  `;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Remove timezone';
  removeBtn.innerHTML = '✕';
  removeBtn.addEventListener('click', () => {
    removeZone(tz);
  });

  card.appendChild(analogWrap);
  card.appendChild(info);
  card.appendChild(removeBtn);

  if (!state.analog) analogWrap.style.display = 'none';

  return card;
}

function renderClocks() {
  els.clocksContainer.innerHTML = '';
  state.zones.forEach(tz => {
    const card = createClockCard(tz);
    els.clocksContainer.appendChild(card);
  });
}

function addZone(tz) {
  if (!tz || typeof tz !== 'string') return;
  tz = tz.trim();
  if (!tz) return;
  if (state.zones.includes(tz)) {
    flashMessage(`${tz} already added.`);
    return;
  }
  // Validate timezone support
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch (err) {
    flashMessage(`Invalid or unsupported timezone: ${tz}`, true);
    return;
  }
  state.zones.push(tz);
  saveState();
  renderClocks();
}

function removeZone(tz) {
  state.zones = state.zones.filter(z => z !== tz);
  saveState();
  renderClocks();
}

function resetDefaults() {
  state.zones = DEFAULT_ZONES.slice();
  state.analog = false;
  state.hour12 = false;
  els.toggleAnalog.checked = false;
  els.toggle12h.checked = false;
  saveState();
  renderClocks();
}

function flashMessage(msg, isError = false) {
  const prev = document.querySelector('.flash-msg');
  if (prev) prev.remove();
  const elMsg = document.createElement('div');
  elMsg.className = 'flash-msg small-muted';
  elMsg.style.color = isError ? '#ff6b6b' : 'var(--muted)';
  elMsg.textContent = msg;
  els.tzInput.parentElement.appendChild(elMsg);
  setTimeout(() => elMsg.remove(), 2800);
}

// Time update loop
function updateClocks() {
  const cards = document.querySelectorAll('.clock-card');
  const now = new Date();
  cards.forEach(card => {
    const tz = card.dataset.timezone;
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      year: 'numeric', month: 'short', day: '2-digit',
      hour12: !!state.hour12,
      timeZone: tz
    });
    const parts = fmt.formatToParts(now);
    const partVal = {};
    parts.forEach(p => { if (p.type && p.value) partVal[p.type] = p.value; });

    let hour = parseInt(partVal.hour, 10);
    const minute = parseInt(partVal.minute || '0', 10);
    const second = parseInt(partVal.second || '0', 10);

    if (state.hour12) {
      const period = partVal.dayPeriod || '';
      if (period.toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (period.toLowerCase() === 'am' && hour === 12) hour = 0;
    }

    // Digital
    const timeEl = card.querySelector('[data-time]');
    if (timeEl) {
      const displayFmt = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: !!state.hour12,
        timeZone: tz
      });
      timeEl.textContent = displayFmt.format(now);
    }

    // Date
    const dateEl = card.querySelector('[data-date]');
    if (dateEl) {
      const dateFmt = new Intl.DateTimeFormat(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: tz
      });
      dateEl.textContent = dateFmt.format(now);
    }

    // Local name / offset
    const localNameEl = card.querySelector('[data-localname]');
    if (localNameEl) {
      try {
        const offsetMin = getTimezoneOffsetMinutes(now, tz);
        const sign = offsetMin <= 0 ? '+' : '-';
        const abs = Math.abs(Math.floor(offsetMin / 60));
        localNameEl.textContent = `UTC${sign}${String(abs).padStart(2,'0')}`;
      } catch (e) {
        localNameEl.textContent = '';
      }
    }

    // Analog hands
    const hourHand = card.querySelector('.hand.hour');
    const minuteHand = card.querySelector('.hand.minute');
    const secondHand = card.querySelector('.hand.second');
    if (hourHand && minuteHand && secondHand) {
      const secondRatio = second / 60;
      const minuteRatio = (minute + secondRatio) / 60;
      const hourFor12 = hour % 12;
      const hourRatio = (hourFor12 + minuteRatio) / 12;
      const hourDeg = hourRatio * 360;
      const minuteDeg = minuteRatio * 360;
      const secondDeg = secondRatio * 360;
      hourHand.style.transform = `translate(-50%,-100%) rotate(${hourDeg}deg)`;
      minuteHand.style.transform = `translate(-50%,-100%) rotate(${minuteDeg}deg)`;
      secondHand.style.transform = `translate(-50%,-100%) rotate(${secondDeg}deg)`;
    }
  });
}

function getTimezoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    hour12: false,
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
  const isoLocal = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
  const asLocal = new Date(isoLocal);
  const diffMs = date.getTime() - asLocal.getTime();
  return Math.round(diffMs / 60000);
}

// Tick
let tickTimer = null;
function startTick() {
  if (tickTimer) clearInterval(tickTimer);
  const now = Date.now();
  const delay = 1000 - (now % 1000);
  setTimeout(() => {
    updateClocks();
    tickTimer = setInterval(updateClocks, 1000);
  }, delay);
}

// UI wiring & Map integration
let map = null;
let marker = null;

function initMap() {
  if (!els.mapElement) return;

  try {
    // Initialize Leaflet
    map = L.map('map', { attributionControl: false }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      minZoom: 2
    }).addTo(map);

    // On map click: reverse geocode and lookup timezone
    map.on('click', async (e) => {
      const { lat, lng } = e.latlng;
      suggestTimezoneFromCoords(lat, lng);
    });

    // If user allows geolocation, center map and suggest local timezone
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        map.setView([lat, lon], 6);
        suggestTimezoneFromCoords(lat, lon, { autoAdd: false });
      }, () => { /* ignore if user denies */ }, { timeout: 8000 });
    }
  } catch (err) {
    console.error('Leaflet init error', err);
  }
}

// Reverse geocode (Nominatim) and timezone lookup (timeapi.io)
async function suggestTimezoneFromCoords(lat, lon, opts = { autoAdd: false }) {
  try {
    // Reverse geocode to get place display name (Nominatim)
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=0`;
    const nomResp = await fetch(nomUrl, { headers: { 'User-Agent': 'solo-leveling-world-clock (singlasaksham0)'}});
    let placeName = '';
    if (nomResp.ok) {
      const nomData = await nomResp.json();
      placeName = nomData.display_name || '';
    }

    // Timezone lookup by coordinates (timeapi.io)
    const tzUrl = `${TIMEZONE_BY_COORD_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
    const tzResp = await fetch(tzUrl);
    if (!tzResp.ok) throw new Error('Timezone lookup failed');
    const tzData = await tzResp.json();
    const tz = tzData?.timeZone || tzData?.time_zone || tzData?.timezone || tzData?.zone || null;
    if (!tz) throw new Error('Timezone not found for coordinates');

    // Place marker & popup suggestion
    if (marker) marker.remove();
    marker = L.marker([lat, lon]).addTo(map);
    const display = placeName ? `${placeName} — ${tz}` : tz;
    marker.bindPopup(`<div style="max-width:260px"><strong>Suggestion</strong><div style="margin-top:6px">${escapeHtml(display)}</div>
      <div style="margin-top:8px"><button id="add-suggested-tz" class="btn">Add ${escapeHtml(tz)}</button></div></div>`).openPopup();

    // Attach click handler to popup button (delegated)
    setTimeout(() => {
      const btn = document.getElementById('add-suggested-tz');
      if (btn) btn.addEventListener('click', () => {
        addZone(tz);
        map.closePopup();
      });
    }, 200);

    // Optionally auto add
    if (opts.autoAdd) {
      addZone(tz);
    }

    flashMessage(`Suggested timezone: ${tz} ${placeName ? `(${placeName})` : ''}`);
  } catch (err) {
    console.error('suggestTimezoneFromCoords error', err);
    flashMessage('Unable to determine timezone for that location', true);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// UI wiring
function wireUI() {
  els.addBtn.addEventListener('click', () => {
    const tz = els.tzInput.value.trim();
    addZone(tz);
    els.tzInput.value = '';
  });
  els.tzInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      els.addBtn.click();
    }
  });

  els.toggleAnalog.checked = state.analog;
  els.toggle12h.checked = state.hour12;

  els.toggleAnalog.addEventListener('change', (e) => {
    state.analog = !!e.target.checked;
    saveState();
    document.querySelectorAll('.clock-card').forEach(card => {
      const analog = card.querySelector('.analog-wrap');
      if (analog) analog.style.display = state.analog ? '' : 'none';
    });
  });

  els.toggle12h.addEventListener('change', (e) => {
    state.hour12 = !!e.target.checked;
    saveState();
    updateClocks();
  });

  els.resetBtn.addEventListener('click', () => resetDefaults());
}

// Initialization
async function init() {
  loadState();
  await buildTimezoneDatalist();
  wireUI();
  renderClocks();
  initMap();
  startTick();
}

window.removeZone = removeZone;
init();