"use strict";

if (!globalThis.__gitlabAssignReviewersLoaded) {
  globalThis.__gitlabAssignReviewersLoaded = true;
  initReviewerButton();
}

function readCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
  if (meta && meta.trim()) return meta.trim();
  const input = document.querySelector('input[name="authenticity_token"]');
  return input?.value?.trim() || "";
}

function pageContext() {
  return {
    mr: globalThis.GitLabReviewers.parseMergeRequestUrl(location.href),
    csrfToken: readCsrfToken()
  };
}

let pageButton = null;

function initReviewerButton() {
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "page-context") return Promise.resolve(pageContext());
    return undefined;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.groups || changes.activeGroupId) refreshPageButtonLabel();
  });

  watchNavigation(syncButton);
  window.setInterval(syncButton, 1000);
  syncButton();
}

function watchNavigation(onChange) {
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  history.pushState = function pushStateAndSync(...args) {
    const result = pushState.apply(this, args);
    onChange();
    return result;
  };
  history.replaceState = function replaceStateAndSync(...args) {
    const result = replaceState.apply(this, args);
    onChange();
    return result;
  };
  window.addEventListener("popstate", onChange);
  window.addEventListener("turbo:load", onChange);
}

function syncButton() {
  const existing = document.getElementById("gitlab-assign-reviewers-host");
  if (!pageContext().mr) {
    existing?.remove();
    pageButton = null;
    return;
  }
  if (existing) return;
  document.documentElement.appendChild(createButton());
}

const BUTTON_CSS = `
  .card {
    width: 240px;
    padding: 10px;
    border: 1px solid #d9d4ce;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 8px 24px rgba(31, 30, 28, 0.16);
    font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
    color: #1f1e1c;
  }
  button {
    width: 100%;
    border: 0;
    border-radius: 7px;
    padding: 8px 10px;
    background: #c84b1a;
    color: #fff;
    font: inherit;
    font-weight: 650;
    white-space: normal;
    cursor: pointer;
  }
  button:disabled { opacity: 0.65; cursor: progress; }
  p { margin: 8px 0 0; }
  .success { color: #1f6b3a; }
  .warning { color: #8a4b08; }
  .error { color: #9f2b2b; }
`;

function createButton() {
  const host = document.createElement("div");
  host.id = "gitlab-assign-reviewers-host";
  host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:1000;";
  const shadow = host.attachShadow({ mode: "open" });
  applyButtonStyles(shadow);

  const card = document.createElement("div");
  card.className = "card";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add team reviewers";
  const status = document.createElement("p");
  status.hidden = true;
  card.append(button, status);
  shadow.append(card);
  pageButton = button;
  button.addEventListener("click", () => assignFromPage(button, status));
  refreshPageButtonLabel();
  return host;
}

async function activeGroupLabel() {
  const stored = await browser.storage.local.get(globalThis.GitLabReviewers.STORAGE_KEYS);
  const group = globalThis.GitLabReviewers.activeGroup(
    globalThis.GitLabReviewers.settingsFromStorage(stored)
  );
  return group?.name ? `Add ${group.name}` : "Add team reviewers";
}

async function refreshPageButtonLabel() {
  if (!pageButton || pageButton.disabled) return;
  const label = await activeGroupLabel();
  if (!pageButton || pageButton.disabled) return;
  pageButton.textContent = label;
}

function applyButtonStyles(shadow) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(BUTTON_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = BUTTON_CSS;
    shadow.append(style);
  }
}

async function assignFromPage(button, status) {
  button.disabled = true;
  button.textContent = "Adding reviewers…";
  showStatus(status, "Asking GitLab…", "");
  try {
    const result = await browser.runtime.sendMessage({ type: "assign" });
    showStatus(status, result?.message || "GitLab did not return a result.", result?.status || "error");
  } catch (error) {
    showStatus(status, error?.message || "Could not add reviewers.", "error");
  } finally {
    button.disabled = false;
    refreshPageButtonLabel();
  }
}

function showStatus(status, message, kind) {
  status.hidden = false;
  status.textContent = message;
  status.className = kind || "";
}
