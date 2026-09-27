import { createSqlClient } from "./sqlClient.js";
import * as db from "./db.js";
import { buildReactions } from "./reactions.js";
import { aggregate } from "./report.js";
import { parseVCard } from "./vcard.js";

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

// ---------- DOM refs ----------

const searchWrap = document.getElementById("search-wrap");
const searchInput = document.getElementById("chat-search");
const searchResults = document.getElementById("search-results");

const uploadPanel = document.getElementById("upload-panel");
const dbFileInput = document.getElementById("db-file");
const vcfFileInput = document.getElementById("vcf-file");
const analyzeBtn = document.getElementById("analyze-btn");
const uploadError = document.getElementById("upload-error");

const emptyState = document.getElementById("empty-state");
const loadingState = document.getElementById("loading-state");
const loadingLabel = document.getElementById("loading-label");
const errorState = document.getElementById("error-state");
const errorMessage = document.getElementById("error-message");
const resultsEl = document.getElementById("results");
const csvBtn = document.getElementById("csv-btn");

// ---------- State ----------

let sql = null;
let chats = [];
let contactNames = {};
let activeIndex = -1;
let currentFilter = [];
let currentChat = null; // { id, rows, columns }
let hasLoadedDb = false; // becomes true only once chats have actually loaded

function setState(name, loadingText) {
  uploadPanel.hidden = name !== "upload";
  emptyState.hidden = name !== "empty";
  loadingState.hidden = name !== "loading";
  errorState.hidden = name !== "error";
  resultsEl.hidden = name !== "results";
  // Independent of the transient state name - the search bar shouldn't
  // appear just because we're in a "loading" state before a db has ever
  // successfully loaded (e.g. the very first spinner after clicking Analyze).
  searchWrap.hidden = !hasLoadedDb;
  if (name === "loading" && loadingText) loadingLabel.textContent = loadingText;
}

function showError(message, { fromUpload = false } = {}) {
  if (fromUpload) {
    hasLoadedDb = false;
    uploadError.textContent = message;
    uploadError.hidden = false;
    setState("upload");
  } else {
    errorMessage.textContent = message;
    setState("error");
  }
}

// ---------- Upload ----------

dbFileInput.addEventListener("change", () => {
  analyzeBtn.disabled = !dbFileInput.files.length;
});

analyzeBtn.addEventListener("click", async () => {
  uploadError.hidden = true;
  const dbFile = dbFileInput.files[0];
  if (!dbFile) return;

  setState("loading", "Reading your database…");

  try {
    const buffer = await dbFile.arrayBuffer();
    sql = createSqlClient();
    await sql.open(buffer);

    if (vcfFileInput.files.length) {
      const vcfText = await vcfFileInput.files[0].text();
      contactNames = parseVCard(vcfText);
    } else {
      contactNames = {};
    }

    setState("loading", "Finding your group chats…");
    chats = await db.listChats(sql);
    hasLoadedDb = true;
    setState("empty");
  } catch (err) {
    console.error(err);
    showError(
      "Couldn't read that file as a chat.db. Make sure you selected the right file " +
        "(usually a copy of ~/Library/Messages/chat.db).",
      { fromUpload: true }
    );
  }
});

// ---------- Search ----------

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
      <div class="search-result" data-index="${i}" data-id="${c.rowid}">
        <span class="name">${escapeHtml(c.display_name || c.chat_identifier)}</span>
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
  const matches = chats.filter((c) =>
    (c.display_name || c.chat_identifier || "").toLowerCase().includes(q)
  );
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
    if (pick) selectChat(pick.rowid);
  } else if (e.key === "Escape") {
    searchResults.hidden = true;
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) {
    searchResults.hidden = true;
  }
});

// ---------- Leaderboard ----------

async function selectChat(chatId) {
  searchResults.hidden = true;
  setState("loading", "Crunching reactions…");

  try {
    const chat = await db.getChat(sql, chatId);
    if (!chat) throw new Error(`No chat with id ${chatId}`);

    const messages = await db.fetchMessages(sql, chatId);
    const { reactions, messageCounts } = buildReactions(messages, false);
    const { rows, columns } = aggregate(reactions, messageCounts, contactNames);

    currentChat = { chat, rows, columns };
    renderLeaderboard(chat, rows, columns, {
      messages: [...messageCounts.values()].reduce((a, b) => a + b, 0),
      reactions: reactions.length,
    });
    setState("results");
  } catch (err) {
    console.error(err);
    showError(err.message || "Couldn't load that chat's leaderboard.");
  }
}

function renderLeaderboard(chat, rows, columns, totals) {
  const chatName = chat.display_name || chat.chat_identifier;
  searchInput.value = chatName;

  document.getElementById("chat-name").textContent = chatName;
  document.getElementById("stat-participants").textContent = chat.participant_count;
  document.getElementById("stat-messages").textContent = totals.messages.toLocaleString();
  document.getElementById("stat-reactions").textContent = totals.reactions.toLocaleString();

  const maxTotal = Math.max(1, ...rows.map((r) => r.totalReactions));

  const board = document.getElementById("leaderboard");
  board.innerHTML = rows
    .map((row, i) => {
      const pct = Math.round((row.totalReactions / maxTotal) * 100);
      const color = AVATAR_COLORS[hashString(row.handle) % AVATAR_COLORS.length];
      const pills = columns
        .map((identity, slot) => {
          const value = row.breakdown.get(identity) || 0;
          return `
          <div class="pill ${value === 0 ? "zero" : ""}">
            <span class="dot" style="background: var(--series-${slot + 1})"></span>
            <span>${emojiFor(identity)}</span>
            <span class="value">${value}</span>
          </div>`;
        })
        .join("");

      return `
        <div class="person-card">
          <div class="person-top">
            <span class="rank">${i + 1}</span>
            <div class="avatar" style="background:${color}">${initialsFor(row.name)}</div>
            <div class="person-name-wrap">
              <div class="person-name">${escapeHtml(row.name)}</div>
              <div class="person-sub">${row.messagesSent.toLocaleString()} messages · ${row.reactionsPerMessage.toFixed(2)} reactions/msg</div>
            </div>
            <div class="person-total">
              <span class="count">${row.totalReactions}</span>
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

// ---------- CSV export ----------

csvBtn.addEventListener("click", () => {
  if (!currentChat) return;
  const { chat, rows, columns } = currentChat;
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(chat.display_name || chat.chat_identifier).replace(/[^\w-]+/g, "_")}_leaderboard.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

function csvField(value) {
  const s = String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows, columns) {
  const header = [
    "name", "handle", "total_reactions", "messages_sent", "reactions_per_message",
    ...columns,
  ];
  const lines = [header.map(csvField).join(",")];
  for (const row of rows) {
    const line = [
      row.name, row.handle, row.totalReactions, row.messagesSent,
      row.reactionsPerMessage.toFixed(4),
      ...columns.map((c) => row.breakdown.get(c) || 0),
    ];
    lines.push(line.map(csvField).join(","));
  }
  return lines.join("\r\n");
}

setState("upload");
