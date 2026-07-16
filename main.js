/**
 * AcodeCord — Discord Rich Presence para Acode
 * v3.0 
 * Mostra arquivo, linguagem, projeto, linhas e tempo codando
 * 
 * ATENÇÃO: uso de token pessoal é self-bot e viola ToS do Discord
 * Use por sua conta e risco. Nunca compartilhe seu token.
 * 
 * Copyright (c) Black Solutions, 2026 - MIT
 */
const PLUGIN_ID = "com.blacksolutions.acodecord";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const STORAGE_KEY = "acodecord_token";
const CONFIG_KEY = "acodecord_config_v3";
const SIDEBAR_APP_ID = "acodecord-settings";
const REPO_URL = "https://github.com/ghosttobygg/acodecord";
const VERSION = "3.0.0";

// -------------------- Estado global --------------------
let ws = null;
let heartbeat = null;
let reconnectTimer = null;
let sequence = null;
let updateDebounce = null;
let idleTimer = null;
let panelRefs = null;
let shouldReconnect = true;
let startedAt = Date.now();
let lastFile = "";
let lastActivitySent = 0;
let reconnectAttempts = 0;
let editorListenerAttached = false;
let isIdle = false;

// -------------------- Helpers base --------------------
const getEM = () => window.editorManager || (typeof acode !== 'undefined' ? acode.require("editorManager") : null);
const getToken = () => { try { return (localStorage.getItem(STORAGE_KEY) || "").trim(); } catch { return ""; } };
const setToken = (t) => { try { localStorage.setItem(STORAGE_KEY, (t || "").trim()); } catch {} };
const toast = (m) => { try { acode.require("toast")(m); } catch { console.log("[AcodeCord] " + m); } };
const log = (...a) => { try { console.log("[AcodeCord]", ...a); } catch {} };

function getConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    // Migra config antiga se existir
    if (!raw._migrated) {
      try {
        const old = JSON.parse(localStorage.getItem("acodecord_config") || "{}");
        Object.assign(raw, old);
      } catch {}
    }
    return {
      status: "dnd",
      appId: "",
      largeImageKey: "acode",
      largeImageText: "Acode Editor",
      smallImageKey: "",
      smallImageText: "",
      showFileName: true,
      showLang: true,
      showLines: true,
      showProject: false,
      privacyMode: false,
      useSmallIconPerLang: true,
      idleTimeout: 5,
      customDetails: "",
      customState: "",
      debug: false,
      _migrated: true,
      ...raw
    };
  } catch {
    return {
      status: "dnd", appId: "", largeImageKey: "acode", largeImageText: "Acode Editor",
      smallImageKey: "", smallImageText: "", showFileName: true, showLang: true,
      showLines: true, showProject: false, privacyMode: false, useSmallIconPerLang: true,
      idleTimeout: 5, customDetails: "", customState: "", debug: false, _migrated: true
    };
  }
}

function setConfig(patch) {
  try {
    const cfg = { ...getConfig(), ...patch, _migrated: true };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  } catch { return getConfig(); }
}

// -------------------- Linguagens (100+ extensões) --------------------
const LANG_MAP = {
  js: ["JavaScript", "js"], jsx: ["JavaScript (JSX)", "react"], ts: ["TypeScript", "ts"], tsx: ["TypeScript (TSX)", "react"],
  py: ["Python", "py"], java: ["Java", "java"], kt: ["Kotlin", "kotlin"], kts: ["Kotlin", "kotlin"],
  c: ["C", "c"], h: ["C Header", "c"], cpp: ["C++", "cpp"], hpp: ["C++ Header", "cpp"], cc: ["C++", "cpp"],
  cs: ["C#", "csharp"], go: ["Go", "go"], rs: ["Rust", "rust"], rb: ["Ruby", "ruby"], php: ["PHP", "php"],
  swift: ["Swift", "swift"], dart: ["Dart", "dart"], html: ["HTML", "html"], htm: ["HTML", "html"],
  css: ["CSS", "css"], scss: ["SCSS", "sass"], sass: ["Sass", "sass"], less: ["Less", "less"],
  json: ["JSON", "json"], jsonc: ["JSON", "json"], xml: ["XML", "xml"], yml: ["YAML", "yaml"], yaml: ["YAML", "yaml"],
  md: ["Markdown", "markdown"], mdx: ["MDX", "markdown"], sql: ["SQL", "sql"], sh: ["Shell", "shell"],
  bash: ["Bash", "shell"], zsh: ["Zsh", "shell"], ps1: ["PowerShell", "powershell"], bat: ["Batch", "shell"],
  lua: ["Lua", "lua"], r: ["R", "r"], vue: ["Vue", "vue"], svelte: ["Svelte", "svelte"],
  astro: ["Astro", "astro"], sol: ["Solidity", "solidity"], toml: ["TOML", "toml"], ini: ["INI", "config"],
  env: ["Dotenv", "config"], dockerfile: ["Dockerfile", "docker"], makefile: ["Makefile", "make"],
  gradle: ["Gradle", "gradle"], kt: ["Kotlin", "kotlin"], rs: ["Rust", "rust"],
  asm: ["Assembly", "asm"], wasm: ["WebAssembly", "wasm"], glsl: ["GLSL", "glsl"]
};

function guessLanguage(filename = "") {
  if (!filename) return { name: "Texto", icon: "text" };
  const lower = filename.toLowerCase();
  if (lower === "dockerfile") return { name: "Dockerfile", icon: "docker" };
  if (lower === "makefile") return { name: "Makefile", icon: "make" };
  const ext = lower.split(".").pop();
  if (LANG_MAP[ext]) return { name: LANG_MAP[ext][0], icon: LANG_MAP[ext][1] };
  return { name: ext.toUpperCase(), icon: "file" };
}

// -------------------- Estatísticas do arquivo --------------------
function getFileStats() {
  try {
    const em = getEM();
    const file = em?.activeFile;
    const content = em?.editor?.getValue?.() || "";
    const lines = content ? content.split("\n").length : 0;
    const chars = content.length;
    const fileName = file?.filename || "";
    const filePath = file?.uri || file?.location || "";
    return { file, fileName, filePath, lines, chars, content };
  } catch {
    return { file: null, fileName: "sem arquivo", filePath: "", lines: 0, chars: 0, content: "" };
  }
}

function getProjectName() {
  try {
    const em = getEM();
    const path = em?.activeFile?.uri || em?.activeFile?.location || "";
    if (!path) return "";
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    return "";
  } catch { return ""; }
}

function formatTemplate(template, data) {
  if (!template) return "";
  return template
    .replace(/{file}/g, data.fileName || "")
    .replace(/{lang}/g, data.langName || "")
    .replace(/{lines}/g, String(data.lines || 0))
    .replace(/{project}/g, data.project || "")
    .replace(/{chars}/g, String(data.chars || 0))
    .slice(0, 128);
}

// -------------------- Builder da Activity --------------------
function currentActivity() {
  const cfg = getConfig();
  const stats = getFileStats();
  const project = getProjectName();
  const langInfo = guessLanguage(stats.fileName);
  const nowIdle = isIdle;

  // Anti spam de arquivo repetido
  if (stats.fileName !== lastFile) {
    lastFile = stats.fileName;
    if (cfg.debug) log("Arquivo trocado:", stats.fileName);
  }

  let details = "";
  let state = "";

  if (nowIdle) {
    details = "Ausente - Acode aberto";
    state = cfg.showProject && project ? `Projeto: ${project}` : "Aguardando...";
  } else if (cfg.privacyMode) {
    details = "Codando em privado";
    state = langInfo.name ? `Linguagem: ${langInfo.name}` : "Ocioso";
  } else {
    if (cfg.customDetails) {
      details = formatTemplate(cfg.customDetails, { fileName: stats.fileName, langName: langInfo.name, lines: stats.lines, project, chars: stats.chars });
    } else {
      if (cfg.showFileName) details = `Editando ${stats.fileName}`.slice(0, 128);
      else details = "Codando no Acode";
    }
    if (cfg.customState) {
      state = formatTemplate(cfg.customState, { fileName: stats.fileName, langName: langInfo.name, lines: stats.lines, project, chars: stats.chars });
    } else {
      const parts = [];
      if (cfg.showLang) parts.push(langInfo.name);
      if (cfg.showLines && stats.lines) parts.push(`${stats.lines} linhas`);
      if (cfg.showProject && project) parts.push(project);
      state = parts.length ? parts.join(" • ").slice(0, 128) : "Ocioso";
    }
  }

  const activity = {
    name: "Acode",
    type: 0,
    details: details || "Acode Editor",
    state: state || "Ocioso",
    timestamps: { start: startedAt }
  };

  // Assets só se tiver appId válido
  if (cfg.appId && /^\d{16,20}$/.test(cfg.appId)) {
    activity.application_id = cfg.appId;
    const assets = {};
    if (cfg.largeImageKey) {
      assets.large_image = cfg.largeImageKey;
      assets.large_text = (cfg.largeImageText || "Acode").slice(0, 128);
    }
    if (cfg.useSmallIconPerLang && langInfo.icon && langInfo.icon !== "file") {
      assets.small_image = langInfo.icon;
      assets.small_text = langInfo.name;
    } else if (cfg.smallImageKey) {
      assets.small_image = cfg.smallImageKey;
      assets.small_text = (cfg.smallImageText || langInfo.name || "").slice(0, 128);
    }
    if (Object.keys(assets).length) activity.assets = assets;
  }

  if (cfg.debug) log("Activity gerada:", activity);
  return activity;
}

// -------------------- Idle detection --------------------
function resetIdleTimer() {
  const cfg = getConfig();
  isIdle = false;
  clearTimeout(idleTimer);
  const timeoutMin = Math.max(1, parseInt(cfg.idleTimeout) || 5);
  idleTimer = setTimeout(() => {
    isIdle = true;
    sendPresence(true);
    if (cfg.debug) log("Entrou em idle");
  }, timeoutMin * 60 * 1000);
}

// -------------------- Editor listeners (fix session.on) --------------------
function attachEditorListener() {
  if (editorListenerAttached) return;
  const em = getEM();
  const editor = em?.editor;
  if (!editor || !editor.on) return;
  try {
    editor.on("change", () => { resetIdleTimer(); scheduleUpdate(); });
    editorListenerAttached = true;
    if (getConfig().debug) log("Editor listener anexado");
  } catch (e) { log("Falha ao anexar listener", e); }
}

function detachEditorListener() {
  if (!editorListenerAttached) return;
  const em = getEM();
  const editor = em?.editor;
  if (!editor) return;
  try {
    if (editor.off) editor.off("change", scheduleUpdate);
    else if (editor.removeListener) editor.removeListener("change", scheduleUpdate);
  } catch {}
  editorListenerAttached = false;
}

function scheduleUpdate() {
  const now = Date.now();
  if (now - lastActivitySent < 1500) {
    clearTimeout(updateDebounce);
    updateDebounce = setTimeout(() => sendPresence(), 2000);
    return;
  }
  clearTimeout(updateDebounce);
  updateDebounce = setTimeout(() => sendPresence(), 2500);
}

function onSwitchFile() {
  resetIdleTimer();
  scheduleUpdate();
}

// -------------------- Gateway Discord --------------------
function getBackoffDelay() {
  // Exponential backoff: 5s, 10s, 20s, 40s max 60s
  const base = 5000;
  const delay = Math.min(base * Math.pow(2, reconnectAttempts), 60000);
  return delay + Math.floor(Math.random() * 1000);
}

function connect() {
  const token = getToken();
  if (!token) { toast("AcodeCord: cole o token primeiro"); return; }
  if (token.length < 50) { toast("AcodeCord: token parece inválido (muito curto)"); return; }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) disconnect(false);

  shouldReconnect = true;
  toast("AcodeCord: conectando...");

  try {
    ws = new WebSocket(GATEWAY_URL);
  } catch (e) {
    toast("Erro WebSocket: " + e.message);
    return;
  }

  ws.onmessage = (ev) => {
    let payload;
    try { payload = JSON.parse(ev.data); } catch { return; }
    const { op, d, s, t } = payload;
    if (s != null) sequence = s;

    switch (op) {
      case 10: // Hello
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          try { ws.send(JSON.stringify({ op: 1, d: sequence })); } catch {}
        }, d.heartbeat_interval);
        reconnectAttempts = 0;
        // Identify como Android - menos detectável
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token,
            properties: { os: "Android", browser: "Discord Android", device: "Android", os_version: "13", browser_version: "200.0" },
            presence: { status: getConfig().status || "dnd", afk: false, activities: [currentActivity()] },
            compress: false,
            large_threshold: 250
          }
        }));
        log("Hello recebido, enviando identify");
        break;

      case 11: // Heartbeat ACK
        break;

      case 1: // Server pede heartbeat
        try { ws.send(JSON.stringify({ op: 1, d: sequence })); } catch {}
        break;

      case 0: // Dispatch
        if (t === "READY") {
          startedAt = Date.now();
          resetIdleTimer();
          sendPresence(true);
          toast("AcodeCord: conectado ao Discord!");
          updatePanel(true);
          log("READY, session:", d.session_id);
        } else if (t === "RESUMED") {
          toast("AcodeCord: sessão resumida");
          log("RESUMED");
        }
        break;

      case 7: // Reconnect
        toast("Discord pediu reconexão");
        disconnect(true);
        setTimeout(connect, 2000);
        break;

      case 9: // Invalid session
        const isInvalid = d === false;
        if (isInvalid) {
          toast("Token inválido ou expirado! Verifique o token");
          shouldReconnect = false;
          disconnect(false);
        } else {
          toast("Sessão inválida, tentando resumir...");
          disconnect(true);
          setTimeout(connect, 3000);
        }
        break;

      default:
        if (getConfig().debug) log("OP desconhecido:", op, payload);
    }
  };

  ws.onclose = (e) => {
    clearInterval(heartbeat);
    updatePanel(false);
    ws = null;
    log("WebSocket fechado:", e.code, e.reason);
    if (shouldReconnect && getToken()) {
      reconnectAttempts++;
      const delay = getBackoffDelay();
      toast(`Desconectado (${e.code}), reconectando em ${Math.round(delay/1000)}s...`);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, delay);
    }
  };

  ws.onerror = (e) => {
    log("WebSocket error", e);
  };
}

function disconnect(willReconnect = false) {
  shouldReconnect = willReconnect;
  clearTimeout(reconnectTimer);
  clearInterval(heartbeat);
  heartbeat = null;
  if (ws) {
    ws.onclose = null;
    try { ws.close(1000, "User disconnect"); } catch {}
    ws = null;
  }
  updatePanel(false);
}

function sendPresence(force = false) {
  if (!ws || ws.readyState !== 1) return;
  const now = Date.now();
  if (!force && now - lastActivitySent < 1500) return;
  lastActivitySent = now;
  const cfg = getConfig();
  try {
    ws.send(JSON.stringify({
      op: 3,
      d: { since: null, activities: [currentActivity()], status: cfg.status || "dnd", afk: isIdle }
    }));
    if (cfg.debug) log("Presence enviada");
  } catch (e) { log("Falha ao enviar presence", e); }
}

// -------------------- UI Painel lateral --------------------
function updatePanel(connected) {
  if (!panelRefs) return;
  panelRefs.dot.style.background = connected ? "#3ba55d" : "#747f8d";
  panelRefs.label.textContent = connected ? "Conectado" : "Desconectado";
  panelRefs.toggle.textContent = connected ? "Desligar" : "Ligar";
  panelRefs.toggle.style.background = connected ? "#ed4245" : "#5865F2";
}

function createLabeledInput(labelText, type, value, placeholder) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  const label = document.createElement("label");
  label.textContent = labelText;
  label.style.cssText = "font-size:11px;opacity:0.7;text-transform:uppercase;letter-spacing:0.5px;";
  const input = document.createElement("input");
  input.type = type; input.value = value || ""; input.placeholder = placeholder || "";
  input.style.cssText = "width:100%;padding:8px;border-radius:6px;background:#2b2d31;color:#fff;border:1px solid #444;font-size:13px;";
  wrap.appendChild(label); wrap.appendChild(input);
  return { wrap, input };
}

function createToggle(labelText, checked) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 0;";
  const label = document.createElement("span");
  label.textContent = labelText; label.style.cssText = "font-size:13px;";
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.checked = !!checked;
  cb.style.cssText = "width:18px;height:18px;";
  row.appendChild(label); row.appendChild(cb);
  return { row, cb };
}

function renderPanel(container) {
  container.innerHTML = "";
  const cfg = getConfig();

  const root = document.createElement("div");
  root.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;max-height:100%;font-family:system-ui;";

  // Header status
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px;background:#2b2d31;border-radius:8px;";
  const dot = document.createElement("span");
  dot.style.cssText = "width:10px;height:10px;border-radius:50%;background:#747f8d;display:inline-block;";
  const label = document.createElement("strong");
  label.textContent = "Desconectado"; label.style.cssText = "font-size:13px;";
  const ver = document.createElement("span");
  ver.textContent = "v" + VERSION; ver.style.cssText = "margin-left:auto;font-size:10px;opacity:0.5;";
  header.append(dot, label, ver);

  // Botões principais
  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "Ligar"; toggleBtn.style.cssText = "padding:10px;border:none;border-radius:8px;background:#5865F2;color:#fff;font-weight:bold;cursor:pointer;";
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Salvar e Conectar"; saveBtn.style.cssText = "padding:10px;border:none;border-radius:8px;background:#3ba55d;color:#fff;font-weight:bold;cursor:pointer;";

  // Seção token
  const tokenField = createLabeledInput("Token do Discord (self-bot)", "password", getToken(), "Cole seu token aqui");
  const tokenHint = document.createElement("div");
  tokenHint.textContent = "Nunca compartilhe seu token. Fica salvo só no seu celular.";
  tokenHint.style.cssText = "font-size:10px;opacity:0.5;margin-top:-8px;";

  // Status
  const statusWrap = document.createElement("div");
  statusWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  const statusLabel = document.createElement("label");
  statusLabel.textContent = "Status do Discord"; statusLabel.style.cssText = "font-size:11px;opacity:0.7;text-transform:uppercase;";
  const statusSel = document.createElement("select");
  statusSel.style.cssText = "width:100%;padding:8px;border-radius:6px;background:#2b2d31;color:#fff;border:1px solid #444;";
  [["online","Online"],["idle","Ausente"],["dnd","Não perturbe"],["invisible","Invisível"]].forEach(([v, t]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = t; if ((cfg.status||"dnd")===v) o.selected = true; statusSel.appendChild(o);
  });
  statusWrap.append(statusLabel, statusSel);

  // Aparência
  const sep1 = document.createElement("hr"); sep1.style.cssText = "border:none;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;";
  const titleAppear = document.createElement("strong"); titleAppear.textContent = "Aparência"; titleAppear.style.cssText = "font-size:12px;opacity:0.9;";
  const appIdField = createLabeledInput("Application ID (opcional, só números)", "text", cfg.appId, "Ex: 123456789012345678");
  const largeKeyField = createLabeledInput("Large Image Key", "text", cfg.largeImageKey, "Ex: acode");
  const largeTextField = createLabeledInput("Large Image Text", "text", cfg.largeImageText, "Ex: Acode Editor");
  const smallKeyField = createLabeledInput("Small Image Key", "text", cfg.smallImageKey, "Ex: javascript");
  const smallTextField = createLabeledInput("Small Image Text", "text", cfg.smallImageText, "Ex: JS");

  // Templates
  const sep2 = document.createElement("hr"); sep2.style.cssText = "border:none;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;";
  const titleTpl = document.createElement("strong"); titleTpl.textContent = "Mensagens custom (use {file} {lang} {lines} {project})"; titleTpl.style.cssText = "font-size:11px;opacity:0.9;";
  const detailsField = createLabeledInput("Details custom", "text", cfg.customDetails, "Ex: Codando {file}");
  const stateField = createLabeledInput("State custom", "text", cfg.customState, "Ex: {lang} • {lines} linhas");

  // Privacidade e opções
  const sep3 = document.createElement("hr"); sep3.style.cssText = "border:none;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;";
  const titleOpts = document.createElement("strong"); titleOpts.textContent = "Opções"; titleOpts.style.cssText = "font-size:12px;opacity:0.9;";
  const toggles = [
    createToggle("Mostrar nome do arquivo", cfg.showFileName),
    createToggle("Mostrar linguagem", cfg.showLang),
    createToggle("Mostrar linhas", cfg.showLines),
    createToggle("Mostrar projeto", cfg.showProject),
    createToggle("Ícone por linguagem", cfg.useSmallIconPerLang),
    createToggle("Modo privado (esconde arquivo)", cfg.privacyMode),
    createToggle("Debug logs no console", cfg.debug)
  ];

  const idleField = createLabeledInput("Tempo pra ficar ausente (minutos)", "number", String(cfg.idleTimeout), "5");

  // Footer
  const footer = document.createElement("div");
  footer.style.cssText = "font-size:10px;opacity:0.5;text-align:center;line-height:1.6;padding:8px;";
  footer.innerHTML = `AcodeCord v${VERSION}<br>Black Solutions © 2026 - MIT<br><a href="#" style="color:#5865F2;">GitHub</a> • Feito com ❤️ para Acode`;

  panelRefs = { dot, label, toggle: toggleBtn };

  // Eventos
  toggleBtn.onclick = () => {
    if (ws) disconnect(false);
    else { setToken(tokenField.input.value); connect(); }
  };

  saveBtn.onclick = () => {
    const newCfg = {
      status: statusSel.value,
      appId: appIdField.input.value.trim(),
      largeImageKey: largeKeyField.input.value.trim(),
      largeImageText: largeTextField.input.value.trim(),
      smallImageKey: smallKeyField.input.value.trim(),
      smallImageText: smallTextField.input.value.trim(),
      customDetails: detailsField.input.value.trim(),
      customState: stateField.input.value.trim(),
      showFileName: toggles[0].cb.checked,
      showLang: toggles[1].cb.checked,
      showLines: toggles[2].cb.checked,
      showProject: toggles[3].cb.checked,
      useSmallIconPerLang: toggles[4].cb.checked,
      privacyMode: toggles[5].cb.checked,
      debug: toggles[6].cb.checked,
      idleTimeout: parseInt(idleField.input.value) || 5
    };
    if (newCfg.appId && !/^\d{16,20}$/.test(newCfg.appId)) { toast("Application ID deve ter 16 a 20 números"); return; }
    setToken(tokenField.input.value);
    setConfig(newCfg);
    toast("AcodeCord: configurações salvas!");
    resetIdleTimer();
    if (!ws) connect(); else sendPresence(true);
  };

  footer.querySelector("a").onclick = (e) => {
    e.preventDefault();
    try { acode.require("system").openInBrowser(REPO_URL); } catch { window.open(REPO_URL, "_blank"); }
  };

  // Monta tudo
  root.append(header, toggleBtn, tokenField.wrap, tokenHint, statusWrap, sep1, titleAppear, appIdField.wrap, largeKeyField.wrap, largeTextField.wrap, smallKeyField.wrap, smallTextField.wrap, sep2, titleTpl, detailsField.wrap, stateField.wrap, sep3, titleOpts);
  toggles.forEach(t => root.appendChild(t.row));
  root.append(idleField.wrap, saveBtn, footer);
  container.appendChild(root);
  updatePanel(!!ws && ws.readyState === 1);
}

// -------------------- Ciclo de vida do plugin --------------------
if (typeof acode !== 'undefined') {
  acode.setPluginInit(PLUGIN_ID, async (baseUrl) => {
    try { acode.addIcon("acodecord-logo", baseUrl + "icon.png"); } catch {}
    try {
      const sb = acode.require("sidebarApps");
      sb.add("acodecord-logo", SIDEBAR_APP_ID, "AcodeCord", renderPanel, false);
    } catch (e) { log("Sidebar fail", e); }

    const em = getEM();
    if (em) {
      try { em.on("switch-file", onSwitchFile); } catch {}
      try { em.on("save-file", () => { resetIdleTimer(); scheduleUpdate(); }); } catch {}
      try { em.on("rename-file", onSwitchFile); } catch {}
      attachEditorListener();
      setTimeout(attachEditorListener, 1500);
      setTimeout(attachEditorListener, 4000);
    }

    resetIdleTimer();
    if (getToken()) setTimeout(connect, 1200);
    log("Plugin iniciado v" + VERSION);
  });

  acode.setPluginUnmount(PLUGIN_ID, () => {
    clearTimeout(updateDebounce);
    clearTimeout(reconnectTimer);
    clearTimeout(idleTimer);
    clearInterval(heartbeat);
    disconnect(false);
    detachEditorListener();
    const em = getEM();
    try { em.off("switch-file", onSwitchFile); } catch {}
    try { em.off("save-file", scheduleUpdate); } catch {}
    try { em.off("rename-file", onSwitchFile); } catch {}
    try { acode.require("sidebarApps").remove(SIDEBAR_APP_ID); } catch {}
    panelRefs = null;
    log("Plugin desmontado");
  });
}
