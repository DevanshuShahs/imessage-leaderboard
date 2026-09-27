// The 6 canonical tapback identities map to a fixed emoji glyph. Anything
// else is a custom emoji tapback (iOS's "any emoji" reaction) - the
// identity string returned by the API *is* the emoji already, so it's
// rendered as-is. Which 6 identities actually appear is decided server-side
// per chat (report.top_breakdown_columns) - could be all 6 canonical, could
// be a mix, could be mostly custom emoji.
const CANONICAL_EMOJI = {
  loved: "❤️",
  liked: "👍",
  disliked: "👎",
  laughed: "😂",
  emphasized: "‼️",
  questioned: "❓",
};

function emojiFor(identity) {
  return CANONICAL_EMOJI[identity] || identity;
}

const AVATAR_COLORS = [
  "#2a78d6", "#eb6834", "#1baf7a", "#c98500",
  "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];

const searchInput = document.getElementById("chat-search");
const searchResults = document.getElementById("search-results");
const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const errorMessage = document.getElementById("error-message");
const resultsEl = document.getElementById("results");

let chats = [];
let activeIndex = -1;
let currentFilter = [];

function setState(name) {
  emptyState.hidden = name !== "empty";
  loadingState.hidden = name !== "loading";
  errorState.hidden = name !== "error";
  resultsEl.hidden = name !== "results";
}

function showError(message) {
  errorMessage.textContent = message;
  setState("error");
}

async function loadChats() {
  try {
    const res = await fetch("/api/chats");
    if (!res.ok) throw new Error("Failed to load chats");
    chats = await res.json();
  } catch (err) {
    chats = [];
    showError("Couldn't load chats. Is the database path correct?");
  }
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderSearchResults(matches) {
  currentFilter = matches;
  activeIndex = -1;

  if (matches.length === 0) {
    searchResults.innerHTML = `<div class="search-empty">No matching chats</div>`;
    searchResults.hidden = false;
    return;
  }

  searchResults.innerHTML = matches
    .slice(0, 30)
    .map(
      (c, i) => `
      <div class="search-result" data-index="${i}" data-id="${c.id}">
        <span class="name">${escapeHtml(c.name)}</span>
        <span class="count">${c.participant_count} people</span>
      </div>`
    )
    .join("");
  searchResults.hidden = false;

  searchResults.querySelectorAll(".search-result").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectChat(parseInt(el.dataset.id, 10));
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateActiveHighlight() {
  searchResults.querySelectorAll(".search-result").forEach((el) => {
    el.classList.toggle("active", parseInt(el.dataset.index, 10) === activeIndex);
  });
}

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchResults.hidden = true;
    return;
  }
  const matches = chats.filter((c) => c.name.toLowerCase().includes(q));
  renderSearchResults(matches);
});

searchInput.addEventListener("keydown", (e) => {
  if (searchResults.hidden) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, currentFilter.length - 1);
    updateActiveHighlight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActiveHighlight();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const pick = activeIndex >= 0 ? currentFilter[activeIndex] : currentFilter[0];
    if (pick) selectChat(pick.id);
  } else if (e.key === "Escape") {
    searchResults.hidden = true;
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) {
    searchResults.hidden = true;
  }
});

const AUTO_REFRESH_MS = 2 * 60 * 1000; // re-render the open chat every 2 minutes
let currentChatId = null;

async function selectChat(chatId) {
  searchResults.hidden = true;
  setState("loading");

  try {
    const data = await fetchLeaderboard(chatId);
    currentChatId = chatId;
    renderLeaderboard(data);
    setState("results");
  } catch (err) {
    showError(err.message || "Couldn't load that chat's leaderboard.");
  }
}

async function fetchLeaderboard(chatId) {
  const res = await fetch(`/api/leaderboard?chat=${chatId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// Quietly re-fetch and re-render the currently open chat on a timer, without
// touching the loading/error states - a failed background refresh just
// leaves the last-good data on screen rather than disrupting the viewer.
setInterval(async () => {
  if (currentChatId === null || resultsEl.hidden) return;
  try {
    renderLeaderboard(await fetchLeaderboard(currentChatId));
  } catch (err) {
    console.warn("Background refresh failed:", err);
  }
}, AUTO_REFRESH_MS);

function renderLeaderboard(data) {
  const chatNameInput = data.chat.name;
  searchInput.value = chatNameInput;

  document.getElementById("chat-name").textContent = chatNameInput;
  document.getElementById("stat-participants").textContent = data.chat.participant_count;
  document.getElementById("stat-messages").textContent = data.totals.messages.toLocaleString();
  document.getElementById("stat-reactions").textContent = data.totals.reactions.toLocaleString();

  const rows = data.rows;
  const columns = data.tapback_columns;
  const maxTotal = Math.max(1, ...rows.map((r) => r.total_reactions));

  const board = document.getElementById("leaderboard");
  board.innerHTML = rows
    .map((row, i) => {
      const pct = Math.round((row.total_reactions / maxTotal) * 100);
      const color = AVATAR_COLORS[hashString(row.handle) % AVATAR_COLORS.length];
      const pills = columns.map((identity, slot) => {
        const value = row.breakdown[identity] || 0;
        return `
          <div class="pill ${value === 0 ? "zero" : ""}">
            <span class="dot" style="background: var(--series-${slot + 1})"></span>
            <span>${emojiFor(identity)}</span>
            <span class="value">${value}</span>
          </div>`;
      }).join("");

      return `
        <div class="person-card">
          <div class="person-top">
            <span class="rank">${i + 1}</span>
            <div class="avatar" style="background:${color}">${initialsFor(row.name)}</div>
            <div class="person-name-wrap">
              <div class="person-name">${escapeHtml(row.name)}</div>
              <div class="person-sub">${row.messages_sent.toLocaleString()} messages · ${row.reactions_per_message.toFixed(2)} reactions/msg</div>
            </div>
            <div class="person-total">
              <span class="count">${row.total_reactions}</span>
              <span class="label">reactions</span>
            </div>
          </div>
          <div class="rank-bar-track">
            <div class="rank-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="breakdown">${pills}</div>
        </div>`;
    })
    .join("");
}

setState("empty");
loadChats();
