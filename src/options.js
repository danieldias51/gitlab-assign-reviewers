"use strict";

const api = globalThis.GitLabReviewers;

const form = document.querySelector("#settings");
const originInput = document.querySelector("#origin");
const groupList = document.querySelector("#group-list");
const groupNameInput = document.querySelector("#group-name");
const usernamesInput = document.querySelector("#usernames");
const defaultInput = document.querySelector("#group-default");
const addGroupButton = document.querySelector("#add-group");
const removeGroupButton = document.querySelector("#remove-group");
const tokenInput = document.querySelector("#token");
const tokenField = document.querySelector("#token-field");
const showToken = document.querySelector("#show-token");
const saveButton = form.querySelector("button[type='submit']");
const statusEl = document.querySelector("#status");

let savedOrigin = "";
let groups = [];
let activeGroupId = "";
let editingId = "";

form.addEventListener("submit", saveSettings);
form.addEventListener("change", syncAuthFields);
showToken.addEventListener("change", () => {
  tokenInput.type = showToken.checked ? "text" : "password";
});
addGroupButton.addEventListener("click", addGroup);
removeGroupButton.addEventListener("click", removeGroup);
groupNameInput.addEventListener("input", () => {
  const group = currentGroup();
  if (!group) return;
  group.name = groupNameInput.value;
  renderGroupSwitch();
});
defaultInput.addEventListener("change", () => {
  if (!editingId) return;
  if (!defaultInput.checked) {
    defaultInput.checked = true;
    return;
  }
  activeGroupId = editingId;
  renderGroupSwitch();
});

loadSettings();

function currentGroup() {
  return groups.find((group) => group.id === editingId) || null;
}

function readEditorIntoGroup() {
  const group = currentGroup();
  if (!group) return;
  group.name = groupNameInput.value;
  group.usernames = api.parseUsernames(usernamesInput.value);
}

function fillEditor() {
  const group = currentGroup();
  groupNameInput.value = group?.name || "";
  usernamesInput.value = group ? group.usernames.join(", ") : "";
  defaultInput.checked = Boolean(group) && group.id === activeGroupId;
  removeGroupButton.disabled = groups.length < 2;
}

function renderGroupSwitch() {
  groupList.replaceChildren();
  for (const group of groups) {
    const button = document.createElement("button");
    button.type = "button";
    const name = group.name.trim() || "Untitled";
    button.textContent = group.id === activeGroupId ? `${name} · default` : name;
    button.setAttribute("aria-pressed", String(group.id === editingId));
    button.addEventListener("click", () => showGroup(group.id));
    groupList.append(button);
  }
}

function showGroup(id) {
  if (id === editingId) return;
  readEditorIntoGroup();
  editingId = id;
  fillEditor();
  renderGroupSwitch();
}

function addGroup() {
  readEditorIntoGroup();
  const group = { id: api.newGroupId(), name: "New group", usernames: [] };
  groups.push(group);
  editingId = group.id;
  fillEditor();
  renderGroupSwitch();
  groupNameInput.focus();
  groupNameInput.select();
}

function removeGroup() {
  if (groups.length < 2) return;
  const removedId = editingId;
  groups = groups.filter((group) => group.id !== removedId);
  if (activeGroupId === removedId) activeGroupId = groups[0].id;
  editingId = groups[0].id;
  fillEditor();
  renderGroupSwitch();
}

async function loadSettings() {
  saveButton.disabled = true;
  try {
    const stored = await browser.storage.local.get(api.STORAGE_KEYS);
    const settings = api.settingsFromStorage(stored);
    originInput.value = settings.gitlabOrigin;
    tokenInput.value = settings.accessToken;
    savedOrigin = settings.gitlabOrigin;
    groups = settings.groups.map((group) => ({
      id: group.id,
      name: group.name,
      usernames: [...group.usernames]
    }));
    activeGroupId = settings.activeGroupId;
    editingId = activeGroupId;
    const selected = form.querySelector(`input[name="authMode"][value="${settings.authMode}"]`);
    if (selected) selected.checked = true;
    syncAuthFields();
    fillEditor();
    renderGroupSwitch();
  } catch (error) {
    showStatus(error?.message || "Could not load saved settings.", "error");
  } finally {
    saveButton.disabled = false;
  }
}

function syncAuthFields() {
  tokenField.hidden = selectedAuthMode() !== "token";
}

function selectedAuthMode() {
  return form.querySelector('input[name="authMode"]:checked')?.value || "session";
}

async function saveSettings(event) {
  event.preventDefault();
  readEditorIntoGroup();
  const parsed = api.parseSettingsInput({
    gitlabOrigin: originInput.value,
    groups,
    activeGroupId,
    authMode: selectedAuthMode(),
    accessToken: tokenInput.value
  });
  if (parsed.error) {
    showStatus(parsed.error, "error");
    return;
  }

  const nextOrigin = parsed.value.gitlabOrigin;
  const previousOrigin = savedOrigin;
  saveButton.disabled = true;
  try {
    const granted = await browser.permissions.request({
      origins: [api.hostPattern(nextOrigin)]
    });
    if (!granted) {
      showStatus("Firefox needs permission for that GitLab site before the button can add reviewers.", "error");
      return;
    }

    await browser.storage.local.set(parsed.value);
    await browser.storage.local.remove("usernames");
    originInput.value = nextOrigin;
    tokenInput.value = parsed.value.accessToken;
    savedOrigin = nextOrigin;
    groups = parsed.value.groups.map((group) => ({
      id: group.id,
      name: group.name,
      usernames: [...group.usernames]
    }));
    activeGroupId = parsed.value.activeGroupId;
    if (!groups.some((group) => group.id === editingId)) editingId = activeGroupId;
    fillEditor();
    renderGroupSwitch();

    const registration = await browser.runtime.sendMessage({ type: "register-host" });
    if (registration && registration.ok === false) {
      showStatus(registration.message, "error");
      return;
    }

    if (previousOrigin && previousOrigin !== nextOrigin) {
      await browser.permissions.remove({ origins: [api.hostPattern(previousOrigin)] });
    }
  } catch (error) {
    showStatus(error?.message || "Settings were saved, but the page button could not be registered.", "error");
    return;
  } finally {
    saveButton.disabled = false;
  }

  showStatus("Saved. Open a merge request and pick a group in the toolbar popup.", "success");
}

function showStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || "";
}
