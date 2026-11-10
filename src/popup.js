"use strict";

const api = globalThis.GitLabReviewers;

const pageEl = document.querySelector("#page");
const groupSelect = document.querySelector("#group");
const teamEl = document.querySelector("#team");
const authEl = document.querySelector("#auth");
const addButton = document.querySelector("#add");
const resultEl = document.querySelector("#result");

let activeTabId = null;
let canAssign = false;
let settings = null;

document.querySelector("#open-settings").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

addButton.addEventListener("click", assignFromPopup);
groupSelect.addEventListener("change", selectGroup);

initPopup();

async function initPopup() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  const stored = await browser.storage.local.get(api.STORAGE_KEYS);
  settings = api.settingsFromStorage(stored);
  const href = await tabLocation(tab);
  const mergeRequest = href ? api.parseMergeRequestUrl(href) : null;
  const setupError = api.settingsError(settings);

  renderGroups();
  authEl.textContent = settings.authMode === "token"
    ? "Authentication: personal access token"
    : "Authentication: browser session";

  if (setupError) {
    pageEl.textContent = setupError;
    return;
  }
  if (!mergeRequest) {
    pageEl.textContent = "Open a merge request, then come back here. The address should contain /-/merge_requests/ and a number.";
    return;
  }
  if (!api.sameOrigin(mergeRequest.origin, settings.gitlabOrigin)) {
    pageEl.textContent = `This tab is ${mergeRequest.origin}, and the extension is set to ${settings.gitlabOrigin}.`;
    return;
  }

  pageEl.textContent = api.mergeRequestLabel(mergeRequest);
  canAssign = activeTabId != null;
  refreshAssignEnabled();
  const selected = selectedGroup();
  if (selected && !selected.usernames.length) {
    showResult(`Add at least one username to ${selected.name} in settings.`, "error");
  }
}

function selectedGroup() {
  return api.groupById(settings, groupSelect.value) || api.activeGroup(settings);
}

function addLabel(group) {
  return group?.name ? `Add ${group.name}` : "Add team reviewers";
}

function renderGroups() {
  groupSelect.replaceChildren();
  for (const group of settings.groups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    groupSelect.append(option);
  }
  const active = api.activeGroup(settings);
  if (active) groupSelect.value = active.id;
  renderTeam(active?.usernames || []);
  addButton.textContent = addLabel(active);
}

function refreshAssignEnabled() {
  addButton.disabled = !canAssign || !selectedGroup()?.usernames.length;
}

async function selectGroup() {
  const group = selectedGroup();
  if (!settings || !group) return;
  settings.activeGroupId = group.id;
  renderTeam(group.usernames);
  addButton.textContent = addLabel(group);
  resultEl.hidden = true;
  refreshAssignEnabled();
  if (canAssign && !group.usernames.length) {
    showResult(`Add at least one username to ${group.name} in settings.`, "error");
  }
  await browser.storage.local.set({ activeGroupId: group.id });
}

async function tabLocation(tab) {
  if (tab?.url) return tab.url;
  if (tab?.id == null) return "";
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => location.href
    });
    return injection?.result || "";
  } catch {
    return "";
  }
}

function renderTeam(usernames) {
  teamEl.replaceChildren();
  if (!usernames.length) return;
  for (const username of usernames) {
    const item = document.createElement("li");
    item.className = "chip";
    item.textContent = `@${username}`;
    teamEl.appendChild(item);
  }
}

async function assignFromPopup() {
  if (!canAssign) return;
  addButton.disabled = true;
  addButton.textContent = "Adding reviewers…";
  showResult("Asking GitLab…", "");
  try {
    const result = await browser.runtime.sendMessage({
      type: "assign",
      tabId: activeTabId,
      groupId: groupSelect.value
    });
    showResult(result?.message || "GitLab did not return a result.", result?.status || "error");
  } catch (error) {
    showResult(error?.message || "Could not add reviewers.", "error");
  } finally {
    refreshAssignEnabled();
    addButton.textContent = addLabel(selectedGroup());
  }
}

function showResult(message, kind) {
  resultEl.hidden = false;
  resultEl.textContent = message;
  resultEl.className = kind || "";
}
