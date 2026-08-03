/* ============ Forex Live — app logic ============ */

(() => {
  "use strict";

  const FETCH_TRIES = 2;

  const CURRENCY_NAMES = {
    USD: "United States", EUR: "Eurozone", GBP: "United Kingdom", JPY: "Japan",
    CHF: "Switzerland", CAD: "Canada", AUD: "Australia", NZD: "New Zealand",
    CNY: "China", HKD: "Hong Kong", SGD: "Singapore", SEK: "Sweden",
    NOK: "Norway", DKK: "Denmark", TRY: "Turkey", ZAR: "South Africa",
    BRL: "Brazil", MXN: "Mexico", INR: "India", RUB: "Russia", IDR: "Indonesia",
    THB: "Thailand", KRW: "South Korea", TWD: "Taiwan", PLN: "Poland",
    HUF: "Hungary", CZK: "Czech Republic", ILS: "Israel", CLP: "Chile",
    COP: "Colombia", ARS: "Argentina", NGN: "Nigeria", AED: "UAE",
    SAR: "Saudi Arabia", MYR: "Malaysia", PHP: "Philippines", VND: "Vietnam",
    PKR: "Pakistan", BDT: "Bangladesh", EGP: "Egypt", KES: "Kenya", NIS: "Israel",
    ALL: "Global", WORLD: "Global", EURAX: "EU/AX", USDEUR: "Europe", EURD: "Eurozone",
  };

  const FLAG_IDS = {
    USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", CHF: "ch", CAD: "ca",
    AUD: "au", NZD: "nz", CNY: "cn", HKD: "hk", SGD: "sg", SEK: "se",
    NOK: "no", DKK: "dk", TRY: "tr", ZAR: "za", BRL: "br", MXN: "mx",
    INR: "in", RUB: "ru", IDR: "id", THB: "th", KRW: "kr", TWD: "tw",
    PLN: "pl", HUF: "hu", CZK: "cz", ILS: "il", CLP: "cl", COP: "co",
    ARS: "ar", NGN: "ng", AED: "ae", SAR: "sa", MYR: "my", PHP: "ph",
    VND: "vn", PKR: "pk", BDT: "bd", EGP: "eg", KES: "ke",
  };

  const COUNTRY_CODE_MAP = {
    ALL: "ALL", EUR: "EUR", GBP: "GBP", USD: "USD", AUD: "AUD", NZD: "NZD",
    JPY: "JPY", CAD: "CAD", CHF: "CHF", CNY: "CNY", HKD: "HKD", SGD: "SGD",
    SEK: "SEK", NOK: "NOK", DKK: "DKK", TRY: "TRY", ZAR: "ZAR", BRL: "BRL",
    MXN: "MXN", INR: "INR", RUB: "RUB", IDR: "IDR", THB: "THB", KRW: "KRW",
    TWD: "TWD", PLN: "PLN", HUF: "HUF", CZK: "CZK", ILS: "ILS", CLP: "CLP",
    COP: "COP", ARS: "ARS", NGN: "NGN", AED: "AED", SAR: "SAR", MYR: "MYR",
    PHP: "PHP", VND: "VND", PKR: "PKR", BDT: "BDT", EGP: "EGP", KES: "KES",
    "USD/EUR": "EUR", "USD/JPY": "JPY", "USD/AUD": "AUD", "USD/GBP": "GBP",
    "USD/CHF": "CHF", "USD/CAD": "CAD", "USD/NZD": "NZD", "USD/CNY": "CNY",
  };

  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const state = {
    events: [],
    activeDay: null,
    impactFilter: new Set([3, 2, 1, 0]),
    ccyFilter: new Set(),
    search: "",
    dataLoaded: false,
  };

  // client-side polling: re-fetch the cached data file (cache-busted) so fresh
  // actuals announced on Forex Factory appear without a manual reload
  const POLL_INTERVAL = 3 * 60 * 1000;

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    calendar: $("calendar"),
    dayTabs: $("dayTabs"),
    impactFilters: $("impactFilters"),
    currencyFilters: $("currencyFilters"),
    search: $("searchInput"),
    statusBar: $("statusBar"),
    statusText: $("statusText"),
    clearFilters: $("clearFilters"),
    clock: $("clockTime"),
    sync: $("syncStatus"),
    syncLabel: $("syncLabel"),
    dataAge: $("dataAge"),
    nextEvent: $("nextEvent"),
    nextEventLabel: $("nextEventLabel"),
    todayBtn: $("todayBtn"),
    themeToggle: $("themeToggle"),
    archiveCount: $("archiveCount"),
    archiveTable: $("archiveTable"),
  };

  /* ---------- Helpers ---------- */
  const pad = (n, w = 2) => String(n).padStart(w, "0");

  const fmtDate = (d) => `${WEEKDAYS_SHORT[d.getDay()]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  const fmtFull = (d) => `${WEEKDAYS_SHORT[d.getDay()]}day, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${getOrdinal(d.getDate())}`;

  const fmtDateCompact = (d) => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;

  function getOrdinal(n) {
    const r = n % 100;
    if (r >= 11 && r <= 13) return "th";
    const m = n % 10;
    return m === 1 ? "st" : m === 2 ? "nd" : m === 3 ? "rd" : "th";
  }

  const parseImpact = (s) => (s === "High" ? 3 : s === "Medium" ? 2 : s === "Low" ? 1 : 0);

  function fmtAge(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    return `${day} day${day > 1 ? "s" : ""} ago`;
  }

  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
    if (s >= 60) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
    return `${s}s`;
  }

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ff-theme", theme); } catch { /* ignore */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("ff-theme"); } catch { /* ignore */ }
    if (!saved) {
      saved = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    applyTheme(saved);
    el.themeToggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
    });
  }

  function startOfDay(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  /* ---------- Currency helpers ---------- */
  const splitCcy = (s) => String(s || "").trim().split(/\s*\/\s*/).filter(Boolean);

  function ccyName(code) {
    const parts = splitCcy(code);
    if (parts.length === 2) {
      const a = CURRENCY_NAMES[parts[0]] || parts[0];
      const b = CURRENCY_NAMES[parts[1]] || parts[1];
      return `${a} / ${b}`;
    }
    return CURRENCY_NAMES[parts[0]] || "";
  }

  function flagFor(ccy) {
    const parts = splitCcy(ccy);
    let id = FLAG_IDS[parts[0]];
    if (!id && parts.length === 2) id = FLAG_IDS[parts[1]] || "un";
    return id || "un";
  }

  function ccyMain(ccy) {
    const parts = splitCcy(ccy);
    return parts[0] || "";
  }

  /* ---------- Data ---------- */
  function getFeedUrl() {
    const now = new Date();
    let start = startOfDay(now);
    start.setDate(start.getDate() - 3);
    const y = start.getFullYear(), m = pad(start.getMonth() + 1), d = pad(start.getDate());
    return `https://nfs.faireconomy.media/ff_calendar_thisweek.json?from=${y}-${m}-${d}`;
  }

  async function fetchRemote() {
    const res = await fetch(getFeedUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Empty feed");
    return data;
  }

  async function loadData() {
    const embedded = window.__FF_EVENTS;
    const age = window.__FF_FETCHED_AT || null;
    if (Array.isArray(embedded) && embedded.length) {
      state.events = embedded;
      el.sync.dataset.state = "fresh";
      el.syncLabel.textContent = "Up to date";
      el.dataAge.textContent = `just now${age ? " · " + new Date(age).toLocaleString() : ""}`;
      state.dataLoaded = true;
      updateArchive();
      render();
      return;
    }

    for (let i = 0; i < FETCH_TRIES; i++) {
      el.syncLabel.textContent = `Fetching data… (try ${i + 1}/${FETCH_TRIES})`;
      try {
        const data = await fetchRemote();
        state.events = data;
        el.sync.dataset.state = "fresh";
        el.syncLabel.textContent = "Up to date";
        el.dataAge.textContent = "just now (live)";
        state.dataLoaded = true;
        updateArchive();
        render();
        return;
      } catch (err) {
        console.warn("Fetch attempt failed:", err);
      }
    }

    el.sync.dataset.state = "old";
    el.syncLabel.textContent = "Data unavailable";
    el.dataAge.textContent = "unavailable — run update-news.ps1 to refresh";
    renderEmpty("Could not load the economic calendar data.");
  }

  /* ---------- Filtering ---------- */
  function applyFilters() {
    const now = new Date();
    const dayStart = startOfDay(now);
    return state.events
      .filter((e) => {
        if (!state.activeDay) return true;
        return startOfDay(new Date(e.date)).getTime() === state.activeDay;
      })
      .filter((e) => {
        if (state.activeDay !== dayStart.getTime()) return true;
        return new Date(e.date).getTime() > now.getTime();
      })
      .filter((e) => state.impactFilter.has(parseImpact(e.impact)))
      .filter((e) => {
        if (state.ccyFilter.size === 0) return true;
        const parts = splitCcy(e.country);
        return parts.some((p) => state.ccyFilter.has(p));
      })
      .filter((e) => {
        if (!state.search) return true;
        const q = state.search.toLowerCase();
        return e.title.toLowerCase().includes(q) || e.country.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const at = new Date(a.date).getTime(), bt = new Date(b.date).getTime();
        if (at !== bt) return at - bt;
        return parseImpact(b.impact) - parseImpact(a.impact);
      })
      .map((e) => ({ ...e, dt: new Date(e.date) }))
      .map((e) => ({
        ...e,
        isPast: e.dt.getTime() < now.getTime(),
        isToday: startOfDay(e.dt).getTime() === dayStart.getTime(),
        isNext: e.dt.getTime() > now.getTime() && Math.abs(e.dt.getTime() - now.getTime()) < 10 * 60 * 1000,
      }));
  }

  /* ---------- Rendering ---------- */
  function render() {
    renderTabs();
    renderCurrencyFilters();
    renderCalendar();
  }

  function renderTabs() {
    const now = new Date();
    const days = [];
    for (let i = -2; i <= 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      days.push(startOfDay(d));
    }

    const list = days.map((ds) => ({
      ds,
      count: state.events.filter((e) => startOfDay(new Date(e.date)).getTime() === ds.getTime()).length,
    }));

    const todayTs = startOfDay(now).getTime();
    if (!state.activeDay) {
      const first = list.find((d) => d.count > 0);
      state.activeDay = (list.find((d) => d.ds.getTime() === todayTs && d.count > 0) || first || list[0]).ds.getTime();
    }

    const frag = document.createDocumentFragment();
    for (const { ds, count } of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab" + (state.activeDay === ds.getTime() ? " is-active" : "");
      btn.dataset.day = ds.toISOString();
      btn.setAttribute("role", "tab");

      const spanDate = document.createElement("span");
      spanDate.className = "tab-date";
      spanDate.textContent = fmtDateCompact(ds);
      const spanName = document.createElement("span");
      spanName.textContent = WEEKDAYS_SHORT[ds.getDay()];
      const spanCount = document.createElement("span");
      spanCount.className = "count";
      spanCount.textContent = `(${count})`;

      btn.append(spanDate, spanName, spanCount);

      btn.addEventListener("click", () => {
        state.activeDay = ds.getTime();
        renderTabs();
        renderCalendar();
      });
      frag.appendChild(btn);
    }

    el.dayTabs.replaceChildren(frag);
  }

  function buildCurrencyFilters() {
    const ccyCount = new Map();
    for (const e of state.events) {
      for (const c of splitCcy(e.country)) {
        ccyCount.set(c, (ccyCount.get(c) || 0) + 1);
      }
    }
    return [...ccyCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([code]) => code);
  }

  function renderCurrencyFilters() {
    const codes = buildCurrencyFilters();
    if (!codes.length) {
      el.currencyFilters.innerHTML = "";
      return;
    }
    const frag = document.createDocumentFragment();
    for (const code of codes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.dataset.ccy = code;
      btn.setAttribute("aria-pressed", "false");
      if (state.ccyFilter.has(code)) {
        btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", "true");
      }
      const span = document.createElement("span");
      span.textContent = code;
      btn.appendChild(span);
      btn.addEventListener("click", () => {
        if (state.ccyFilter.has(code)) state.ccyFilter.delete(code);
        else state.ccyFilter.add(code);
        renderCurrencyFilters();
        renderCalendar();
      });
      frag.appendChild(btn);
    }
    el.currencyFilters.replaceChildren(frag);
  }

  function defaultImpactFilter() {
    return new Set([3, 2, 1, 0]);
  }

  function impactFilterChanged() {
    const def = defaultImpactFilter();
    return state.impactFilter.size !== def.size || [...def].some((x) => !state.impactFilter.has(x));
  }

  function statusActive() {
    const ccy = state.ccyFilter.size > 0;
    return impactFilterChanged() || ccy || state.search.trim() !== "";
  }

  function renderStatus() {
    const active = statusActive();
    el.statusBar.hidden = !active;
    if (!active) return;
    const parts = [];
    if (impactFilterChanged()) parts.push(`${state.impactFilter.size} impact level${state.impactFilter.size === 1 ? "" : "s"}`);
    if (state.ccyFilter.size) parts.push(`${state.ccyFilter.size} currency${state.ccyFilter.size === 1 ? "" : "s"}`);
    if (state.search.trim()) parts.push(`“${state.search.trim()}”`);
    el.statusText.textContent = `Filtering: ${parts.join(" · ")}`;
  }

  function renderCalendar() {
    renderStatus();
    const rows = applyFilters();

    if (!rows.length) {
      renderEmpty("No events match the current filters.");
      return;
    }

    const groups = new Map();
    for (const row of rows) {
      const key = startOfDay(row.dt).getTime();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const frag = document.createDocumentFragment();
    for (const [key, items] of groups) {
      const g = document.createElement("section");
      g.className = "day-group";
      g.dataset.hasToday = String(items.some((r) => r.isToday));

      const head = document.createElement("div");
      head.className = "day-head";
      const dot = document.createElement("span");
      dot.className = "dot";
      const name = document.createElement("span");
      name.className = "day-name";
      name.textContent = fmtFull(new Date(key));
      const date = document.createElement("span");
      date.className = "day-date";
      date.textContent = fmtDate(new Date(key));
      const count = document.createElement("span");
      count.className = "day-count";
      count.textContent = `${items.length} event${items.length === 1 ? "" : "s"}`;
      head.append(dot, name, date, count);

      const list = document.createElement("div");
      list.className = "events";

      const thead = document.createElement("div");
      thead.className = "event-head";
      const cols = ["Time", "", "Event", "Impact", "Actual", "Forecast", "Previous"];
      for (const c of cols) {
        const th = document.createElement("span");
        th.className = "head-cell";
        th.textContent = c;
        if (c === "") th.classList.add("head-spacer");
        if (c === "Impact") th.classList.add("head-impact");
        thead.appendChild(th);
      }
      list.appendChild(thead);

      for (const row of items) {
        list.appendChild(renderEvent(row));
      }

      g.append(head, list);
      frag.appendChild(g);
    }

    el.calendar.replaceChildren(frag);
  }

  function renderEvent(row) {
    const div = document.createElement("div");
    div.className = "event" + (row.isPast ? " past" : "") + (row.isNext ? " highlight" : "");
    div.dataset.title = row.title.toLowerCase();

    /* time */
    const time = document.createElement("div");
    time.className = "event-time";
    const t = document.createElement("span");
    t.textContent = row.dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const tz = document.createElement("span");
    tz.className = "time-tz";
    tz.textContent = timezoneLabel(row.dt);
    time.append(t, tz);

    /* flag */
    const flagId = flagFor(row.country);
    const img = document.createElement("img");
    img.className = "event-flag";
    img.alt = row.country;
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.classList.add("placeholder");
      img.removeAttribute("src");
      img.textContent = ccyMain(row.country) || "?";
    });
    img.src = `https://flagsapi.com/${flagId.toUpperCase()}/flat/64.png`;

    /* main */
    const main = document.createElement("div");
    main.className = "event-main";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = row.title;
    const ccy = document.createElement("div");
    ccy.className = "event-ccy";
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = row.country;
    const country = document.createElement("span");
    country.className = "country";
    country.textContent = ccyName(row.country);
    ccy.append(code, country);
    main.append(title, ccy);

    /* impact */
    const impact = document.createElement("span");
    impact.className = `impact impact-${parseImpact(row.impact)}`;
    impact.textContent = row.impact;

    /* actual / forecast / previous */
    const actual = cell("Actual", row.actual);
    if (row.actual && row.movement) {
      actual.classList.add(row.movement === "better" ? "mv-better" : "mv-worse");
      actual.setAttribute("title", row.movement === "better" ? "Better than forecast" : "Worse than forecast");
    }

    const forecast = cell("Forecast", row.forecast);
    const previous = cell("Previous", row.previous);

    /* mobile stats strip (hidden on desktop) */
    const stats = document.createElement("div");
    stats.className = "event-stats";
    stats.append(
      statCell("Actual", row.actual || "—", row.movement),
      statCell("Forecast", row.forecast || "—"),
      statCell("Previous", row.previous || "—")
    );

    div.append(time, img, main, impact, stats, actual, forecast, previous);
    return div;
  }

  function cell(label, value) {
    const c = document.createElement("div");
    c.className = "cell" + (value ? " value" : " empty");
    const l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = value || "—";
    c.append(l, v);
    return c;
  }

  function statCell(label, value, movement) {
    const s = document.createElement("span");
    s.className = "stat-" + label.toLowerCase();
    if (movement) s.classList.add(movement);
    const l = document.createElement("span");
    l.textContent = label;
    const b = document.createElement("b");
    b.textContent = value;
    s.append(l, b);
    return s;
  }

  function timezoneLabel(d) {
    try {
      return d.toLocaleTimeString([], { timeZoneName: "short" }).split(" ").pop();
    } catch {
      return "";
    }
  }

  function renderEmpty(message) {
    el.calendar.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <rect x="3" y="4" width="18" height="17" rx="2"/>
        <path d="M8 2v4M16 2v4M3 9h18"/>
      </svg>
      <p>${message}</p>
      <p class="hint">${state.dataLoaded ? "Try adjusting the filters above." : "Refresh the page or run update-news.ps1."}</p>
    `;
    if (state.dataLoaded) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link-btn";
      btn.textContent = "Clear all filters";
      btn.addEventListener("click", clearAllFilters);
      div.appendChild(btn);
    }
    el.calendar.appendChild(div);
  }

  /* ---------- Filters ---------- */
  function clearAllFilters() {
    state.impactFilter = new Set([3, 2, 1, 0]);
    state.ccyFilter = new Set();
    state.search = "";
    el.search.value = "";
    renderImpactFilters();
    render();
  }

  function renderImpactFilters() {
    el.impactFilters.querySelectorAll(".chip").forEach((chip) => {
      const on = state.impactFilter.has(Number(chip.dataset.impact));
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", String(on));
    });
  }

  el.impactFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".chip");
    if (!btn) return;
    const level = Number(btn.dataset.impact);
    if (state.impactFilter.has(level)) state.impactFilter.delete(level);
    else state.impactFilter.add(level);
    renderImpactFilters();
    renderCalendar();
  });

  el.search.addEventListener("input", () => {
    state.search = el.search.value;
    renderCalendar();
  });

  el.clearFilters.addEventListener("click", clearAllFilters);

  el.todayBtn.addEventListener("click", () => {
    state.activeDay = startOfDay(new Date()).getTime();
    renderTabs();
    renderCalendar();
  });

  document.addEventListener("keydown", (ev) => {
    const target = ev.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (ev.key === "t" || ev.key === "T") {
      el.todayBtn.click();
    } else if (ev.key === "/") {
      ev.preventDefault();
      el.search.focus();
    }
  });

  /* ---------- Archive (separate table below the calendar) ---------- */
  const archive = {
    list: [],
    lastCount: -1,
  };

  function updateArchive() {
    const now = new Date();
    const dayStart = startOfDay(now);
    archive.list = state.events
      .filter((e) => {
        const d = new Date(e.date);
        return startOfDay(d).getTime() === dayStart.getTime() && d.getTime() <= now.getTime();
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    renderArchive();
  }

  function renderArchive() {
    const n = archive.list.length;
    el.archiveCount.textContent = n;

    el.archiveTable.innerHTML = "";

    const thead = document.createElement("div");
    thead.className = "event-head arch-head-row";
    for (const c of ["Time", "", "Event", "Impact", "Usual Effect", "Actual", "Forecast", "Previous"]) {
      const th = document.createElement("span");
      th.className = "head-cell";
      th.textContent = c;
      if (c === "") th.classList.add("head-spacer");
      thead.appendChild(th);
    }
    el.archiveTable.appendChild(thead);

    if (!archive.list.length) {
      const empty = document.createElement("div");
      empty.className = "arch-empty";
      empty.textContent = "No news has been announced yet today.";
      el.archiveTable.appendChild(empty);
      return;
    }

    archive.list.forEach((ev) => {
      const d = new Date(ev.date);
      const row = document.createElement("div");
      row.className = "arch-row";

      const time = document.createElement("span");
      time.className = "arch-time";
      time.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const code = document.createElement("span");
      code.className = "arch-code";
      code.textContent = ev.country;

      const title = document.createElement("span");
      title.className = "arch-title";
      title.textContent = ev.title;

      const impact = document.createElement("span");
      impact.className = `impact impact-${parseImpact(ev.impact)}`;
      impact.textContent = ev.impact;

      /* Usual Effect: filled dot for High/Medium announced events
         (green = good for the currency, red = bad, grey = matched forecast) */
      const effect = document.createElement("span");
      effect.className = "arch-effect";
      effect.title = "—";
      const lvl = parseImpact(ev.impact);
      if (lvl >= 2 && ev.actual) {
        const cls = ev.movement === "better" ? "good" : ev.movement === "worse" ? "bad" : "neutral";
        effect.title = cls === "good" ? "Good for currency" : cls === "bad" ? "Bad for currency" : "Neutral (matched forecast)";
        const dot = document.createElement("span");
        dot.className = "dot " + cls;
        effect.appendChild(dot);
      } else {
        effect.textContent = "—";
      }

      const actual = document.createElement("span");
      actual.className = "arch-actual" + (ev.movement ? ` mv-${ev.movement}` : "");
      actual.textContent = ev.actual || "—";

      const forecast = document.createElement("span");
      forecast.className = "arch-num";
      forecast.textContent = ev.forecast || "—";

      const previous = document.createElement("span");
      previous.className = "arch-num";
      previous.textContent = ev.previous || "—";

      const stats = document.createElement("div");
      stats.className = "arch-stats";
      stats.append(
        statCell("Actual", ev.actual || "—", ev.movement),
        statCell("Forecast", ev.forecast || "—"),
        statCell("Previous", ev.previous || "—")
      );

      row.append(time, code, title, impact, effect, stats, actual, forecast, previous);
      el.archiveTable.appendChild(row);
    });
  }

  /* ---------- Clock & countdowns ---------- */
  function updateTicker() {
    const now = new Date();
    const upcoming = state.events
      .map((e) => ({ e, t: new Date(e.date).getTime() }))
      .filter((x) => x.t > now.getTime() && parseImpact(x.e.impact) > 0)
      .sort((a, b) => a.t - b.t)[0];
    if (!upcoming) {
      el.nextEvent.hidden = true;
      return;
    }
    const remain = upcoming.t - now.getTime();
    const when = remain < 24 * 3600 * 1000
      ? `in ${fmtCountdown(remain)}`
      : upcoming.e.date.slice(0, 10);
    el.nextEventLabel.textContent = `${upcoming.e.title} · ${when}`;
    el.nextEvent.title = `${upcoming.e.title} — ${upcoming.e.country} · ${new Date(upcoming.t).toLocaleString()}`;
    el.nextEvent.hidden = false;
  }

  function tick() {
    const now = new Date();
    el.clock.textContent = now.toLocaleTimeString();
    updateTicker();
    document.querySelectorAll(".event.is-next .event-time").forEach((node) => {
      const row = node.closest(".event");
      const title = row.dataset.title;
      const ev = state.events.find((e) => e.title.toLowerCase() === title);
      if (ev) {
        const remain = new Date(ev.date).getTime() - now.getTime();
        if (remain < -30 * 1000) row.classList.remove("highlight");
        else node.firstChild.textContent = `in ${fmtCountdown(remain)}`;
      }
    });
  }

  el.clock.textContent = new Date().toLocaleTimeString();
  setInterval(tick, 1000);

  /* ---------- Data freshness ---------- */
  function updateFreshness() {
    const meta = window.__FF_META || null;
    const age = window.__FF_FETCHED_AT || (meta && meta.fetchedAt) || null;
    if (!age) return;
    const ms = Date.now() - new Date(age).getTime();
    el.dataAge.textContent = fmtAge(ms);
    const stale = ms > 12 * 3600 * 1000;
    el.sync.dataset.state = stale ? "stale" : "fresh";
    el.syncLabel.textContent = stale ? "Data older than 12h" : "Up to date";
  }
  setInterval(updateFreshness, 60 * 1000);

  /* ---------- Boot ---------- */
  initTheme();
  loadData();

  /* ---------- Background polling ---------- */
  async function pollForUpdates() {
    if (!state.dataLoaded) return;
    try {
      const res = await fetch(`data/data-embedded.js?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      const m = text.match(/window\.__FF_FETCHED_AT\s*=\s*'([^']+)'/);
      if (!m || m[1] === window.__FF_FETCHED_AT) return; // unchanged

      const holder = {};
      const fn = new Function("window", text);
      fn(holder);
      if (!Array.isArray(holder.__FF_EVENTS) || !holder.__FF_EVENTS.length) return;
      window.__FF_EVENTS = holder.__FF_EVENTS;
      window.__FF_FETCHED_AT = holder.__FF_FETCHED_AT;
      window.__FF_META = holder.__FF_META || window.__FF_META;
      state.events = holder.__FF_EVENTS;
      el.sync.dataset.state = "fresh";
      el.syncLabel.textContent = "Up to date";
      el.dataAge.textContent = `updated ${fmtAge(Date.now() - new Date(holder.__FF_FETCHED_AT).getTime())}`;
      updateArchive();
      render();
    } catch (err) {
      console.warn("Poll failed:", err);
    }
  }
  setInterval(pollForUpdates, POLL_INTERVAL);
})();
