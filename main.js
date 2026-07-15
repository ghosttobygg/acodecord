/**
 * AcodeCord — Discord Rich Presence para Acode
 * ---------------------------------------------
 * Conecta diretamente ao Gateway do Discord (wss://gateway.discord.gg)
 * usando o token da sua própria conta para atualizar seu status,
 * mostrando o arquivo/linguagem que você está editando no Acode.
 *
 * ATENÇÃO: usar o token da conta pessoal para isso é uma prática
 * "self-bot" e tecnicamente viola os Termos de Serviço do Discord,
 * mesmo sendo comum (é o que apps como o Kizzy fazem). Use por sua
 * conta e risco. NUNCA compartilhe seu token com ninguém.
 *
 * Copyright (c) Black Solutions, 2026.
 * Licenciado sob MIT — veja LICENSE no repositório.
 */

const PLUGIN_ID = "com.blacksolutions.acodecord";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const STORAGE_KEY = "acodecord_token";
const CONFIG_KEY = "acodecord_config"; // { appId, largeImageKey, largeImageText, smallImageKey, smallImageText, status }
const SIDEBAR_APP_ID = "acodecord-settings";
const AUTHOR = "Black Solutions";
const YEAR = 2026;
const REPO_URL = "https://github.com/ghosttobygg/acodecord"; // Link do repositório do projeto

let ws = null;
let heartbeatInterval = null;
let sequence = null;
let sessionId = null;
let updateDebounce = null;
let activityStartedAt = Date.now();
let panelRefs = null; // referências aos elementos do painel, pra atualizar status ao vivo

// -------------------- Utilitários --------------------

function getToken() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

function setToken(token) {
  localStorage.setItem(STORAGE_KEY, token);
}

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

function setConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function guessLanguage(filename = "") {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map = {
    js: "JavaScript", ts: "TypeScript", jsx: "JavaScript (JSX)",
    tsx: "TypeScript (TSX)", py: "Python", java: "Java", kt: "Kotlin",
    c: "C", cpp: "C++", cs: "C#", html: "HTML", css: "CSS",
    scss: "SCSS", json: "JSON", md: "Markdown", php: "PHP",
    go: "Go", rs: "Rust", rb: "Ruby", sh: "Shell", xml: "XML",
    dart: "Dart", swift: "Swift", sql: "SQL",
  };
  return map[ext] || "código";
}

function currentActivity() {
  const file = editorManager.activeFile;
  const filename = file?.filename || "sem arquivo aberto";
  const language = file ? guessLanguage(filename) : null;
  const { appId, largeImageKey, largeImageText, smallImageKey, smallImageText } = getConfig();

  const activity = {
    name: "Acode",
    type: 0,
    details: file ? `Editando ${filename}` : "Não está mexendo em nada...",
    state: language ? `Linguagem: ${language}` : "Ocioso",
    timestamps: { start: activityStartedAt },
  };

  // application_id + assets só funcionam se você criou uma aplicação
  // no Discord Developer Portal e subiu as imagens em
  // Rich Presence > Art Assets. Sem isso, o Discord ignora esses campos.
  if (appId) {
    activity.application_id = appId;
    if (largeImageKey) {
      activity.assets = {
        large_image: largeImageKey,
        large_text: largeImageText || "Acode",
      };
      if (smallImageKey) {
        activity.assets.small_image = smallImageKey;
        activity.assets.small_text = smallImageText || language || "";
      }
    }
  }

  return activity;
}

function toast(msg) {
  acode.require("toast")?.(msg) ?? console.log(msg);
}

// -------------------- Gateway --------------------

function connect() {
  const token = getToken();
  if (!token) {
    toast("AcodeCord: defina o token primeiro");
    return;
  }

  ws = new WebSocket(GATEWAY_URL);

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    const { op, d, s, t } = payload;
    if (s) sequence = s;

    switch (op) {
      case 10: // Hello -> começa o heartbeat e identifica
        startHeartbeat(d.heartbeat_interval);
        identify(token);
        break;
      case 0: // Dispatch
        if (t === "READY") {
          sessionId = d.session_id;
          activityStartedAt = Date.now();
          sendPresence();
          toast("AcodeCord: conectado ao Discord");
          updatePanelStatus(true);
        }
        break;
      case 9: // Sessão inválida
        toast("AcodeCord: sessão inválida, verifique o token");
        disconnect();
        break;
    }
  };

  ws.onclose = () => {
    stopHeartbeat();
    updatePanelStatus(false);
    // tenta reconectar em 5s se ainda houver token salvo
    if (getToken()) setTimeout(connect, 5000);
  };

  ws.onerror = () => {
    // onclose é chamado logo em seguida, o reconnect fica por conta dele
  };
}

function disconnect() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  stopHeartbeat();
  updatePanelStatus(false);
}

function startHeartbeat(interval) {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: 1, d: sequence }));
    }
  }, interval);
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function identify(token) {
  const status = getConfig().status || "dnd";
  ws.send(JSON.stringify({
    op: 2,
    d: {
      token,
      properties: {
        os: "win32",
        browser: "acode-discord-rpc",
        device: "acode-discord-rpc",
      },
      presence: {
        status,
        afk: false,
        activities: [currentActivity()],
      },
    },
  }));
}

function sendPresence() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const status = getConfig().status || "dnd";
  ws.send(JSON.stringify({
    op: 3,
    d: {
      since: null,
      activities: [currentActivity()],
      status,
      afk: false,
    },
  }));
}

function scheduleUpdate() {
  clearTimeout(updateDebounce);
  updateDebounce = setTimeout(sendPresence, 1500);
}

// -------------------- Painel lateral (sidebar app) --------------------

function updatePanelStatus(connected) {
  if (!panelRefs) return;
  panelRefs.statusDot.style.background = connected ? "#3ba55d" : "#747f8d";
  panelRefs.statusLabel.textContent = connected ? "Conectado" : "Desconectado";
  panelRefs.toggleBtn.textContent = connected ? "Desligar" : "Ligar";
}

function renderSidebarPanel(container) {
  const cfg = getConfig();

  container.innerHTML = `
    <div class="acodecord-panel" style="padding:12px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;max-height:100%;">

      <div style="display:flex;align-items:center;gap:8px;">
        <span class="ac-status-dot" style="width:10px;height:10px;border-radius:50%;background:#747f8d;display:inline-block;"></span>
        <strong class="ac-status-label">Desconectado</strong>
      </div>

      <button class="ac-toggle-btn" style="padding:8px;border:none;border-radius:6px;background:#5865F2;color:#fff;font-weight:bold;">Ligar</button>

      <hr style="border-color:rgba(255,255,255,0.1);width:100%;">

      <div>
        <label style="font-size:12px;opacity:0.7;">Token do Discord</label>
        <input class="ac-token" type="password" placeholder="Cole seu token aqui" style="width:100%;padding:6px;margin-top:4px;" value="${escapeAttr(getToken())}">
      </div>

      <div>
        <label style="font-size:12px;opacity:0.7;">Status</label>
        <select class="ac-status" style="width:100%;padding:6px;margin-top:4px;">
          <option value="online" ${cfg.status === "online" ? "selected" : ""}>Online</option>
          <option value="idle" ${cfg.status === "idle" ? "selected" : ""}>Ausente</option>
          <option value="dnd" ${!cfg.status || cfg.status === "dnd" ? "selected" : ""}>Não perturbe</option>
          <option value="invisible" ${cfg.status === "invisible" ? "selected" : ""}>Invisível</option>
        </select>
      </div>

      <hr style="border-color:rgba(255,255,255,0.1);width:100%;">
      <strong>Imagens (opcional)</strong>

      <div>
        <label style="font-size:12px;opacity:0.7;">Application ID</label>
        <input class="ac-appid" type="text" style="width:100%;padding:6px;margin-top:4px;" value="${escapeAttr(cfg.appId || "")}">
      </div>
      <div>
        <label style="font-size:12px;opacity:0.7;">Large Image Key</label>
        <input class="ac-large-key" type="text" style="width:100%;padding:6px;margin-top:4px;" value="${escapeAttr(cfg.largeImageKey || "")}">
      </div>
      <div>
        <label style="font-size:12px;opacity:0.7;">Large Image Text</label>
        <input class="ac-large-text" type="text" style="width:100%;padding:6px;margin-top:4px;" value="${escapeAttr(cfg.largeImageText || "Acode")}">
      </div>
      <div>
        <label style="font-size:12px;opacity:0.7;">Small Image Key</label>
        <input class="ac-small-key" type="text" style="width:100%;padding:6px;margin-top:4px;" value="${escapeAttr(cfg.smallImageKey || "")}">
      </div>
      <div>
        <label style="font-size:12px;opacity:0.7;">Small Image Text</label>
        <input class="ac-small-text" type="text" style="width:100%;padding:6px;margin-top:4px;" value="${escapeAttr(cfg.smallImageText || "")}">
      </div>

      <button class="ac-save-btn" style="padding:8px;border:none;border-radius:6px;background:#3ba55d;color:#fff;font-weight:bold;">Salvar configurações</button>

      <hr style="border-color:rgba(255,255,255,0.1);width:100%;">

      <div style="font-size:11px;opacity:0.6;text-align:center;line-height:1.6;">
        AcodeCord<br>
        Copyright © ${AUTHOR}, ${YEAR}.<br>
        Licenciado sob MIT.<br>
        <a class="ac-repo-link" href="#" style="color:#5865F2;">Código-fonte no GitHub</a>
      </div>
    </div>
  `;

  panelRefs = {
    statusDot: container.querySelector(".ac-status-dot"),
    statusLabel: container.querySelector(".ac-status-label"),
    toggleBtn: container.querySelector(".ac-toggle-btn"),
  };

  container.querySelector(".ac-toggle-btn").onclick = () => {
    if (ws) {
      disconnect();
    } else {
      setToken(container.querySelector(".ac-token").value.trim());
      connect();
    }
  };

  container.querySelector(".ac-save-btn").onclick = () => {
    setToken(container.querySelector(".ac-token").value.trim());
    setConfig({
      status: container.querySelector(".ac-status").value,
      appId: container.querySelector(".ac-appid").value.trim(),
      largeImageKey: container.querySelector(".ac-large-key").value.trim(),
      largeImageText: container.querySelector(".ac-large-text").value.trim(),
      smallImageKey: container.querySelector(".ac-small-key").value.trim(),
      smallImageText: container.querySelector(".ac-small-text").value.trim(),
    });
    toast("AcodeCord: configurações salvas");
    scheduleUpdate();
  };

  container.querySelector(".ac-repo-link").onclick = (e) => {
    e.preventDefault();
    system.openInBrowser?.(REPO_URL) ?? window.open(REPO_URL, "_blank");
  };

  updatePanelStatus(!!ws && ws.readyState === WebSocket.OPEN);
}

function escapeAttr(str = "") {
  return String(str).replace(/"/g, "&quot;");
}

// -------------------- Ciclo de vida do plugin --------------------

if (window.acode) {
  acode.setPluginInit(PLUGIN_ID, async (baseUrl, $page, cache) => {
    const sideBarApps = acode.require("sideBarApps");

    sideBarApps.add(
      "logo-acodecord",
      SIDEBAR_APP_ID,
      "AcodeCord",
      (container) => renderSidebarPanel(container),
      false
    );

    const commands = editorManager.editor.commands;
    commands.addCommand({
      name: "discord-rpc-toggle",
      description: "AcodeCord: ligar/desligar",
      exec: () => {
        if (ws) {
          disconnect();
          toast("AcodeCord: desligado");
        } else {
          connect();
        }
      },
    });

    // Atualiza a presence quando o arquivo ativo muda, é salvo, ou editado
    editorManager.on("switch-file", scheduleUpdate);
    editorManager.on("save-file", scheduleUpdate);
    editorManager.editor.on("change", scheduleUpdate);

    if (getToken()) connect();
  });

  acode.setPluginUnmount(PLUGIN_ID, () => {
    disconnect();
    editorManager.off("switch-file", scheduleUpdate);
    editorManager.off("save-file", scheduleUpdate);
    editorManager.editor.off("change", scheduleUpdate);

    const sideBarApps = acode.require("sideBarApps");
    sideBarApps.remove(SIDEBAR_APP_ID);

    const commands = editorManager.editor.commands;
    commands.removeCommand("discord-rpc-toggle");
  });
}
