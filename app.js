const MODEL_ID = "TinyLlama-1.1B-Chat-v1.0-q4f16_1";
const WEBLLM_CDN_URL = "https://esm.run/@mlc-ai/web-llm";
const BUSINESS_DOC_URL = "./docs/negocio.txt";
const SYSTEM_PROMPT = [
  "Sos el asistente virtual del negocio.",
  "Respondé únicamente usando la información proporcionada.",
  "Si la respuesta no está en la información disponible, decir que no se dispone de esa información.",
].join("\n");

const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("user-input");
const sendButtonEl = document.getElementById("send-button");

let engine = null;
let businessInfo = "";
let webllm = null;

setStatus("Preparando PWA...");
appendMessage("Bot", "Inicializando. La primera carga puede tardar porque el modelo debe descargarse.");

init().catch((error) => {
  console.error("Error al iniciar la aplicación:", error);
  setStatus("No se pudo iniciar la aplicación.");
  appendMessage("Bot", `Error de inicialización: ${error.message}`);
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = inputEl.value.trim();
  if (!question || !engine) {
    return;
  }

  appendMessage("Cliente", question);
  inputEl.value = "";
  setInputEnabled(false);
  setStatus("Generando respuesta...");

  try {
    const reply = await askBusinessAssistant(question);
    appendMessage("Bot", reply);
    setStatus("Listo para responder offline.");
  } catch (error) {
    console.error("Error al generar la respuesta:", error);
    appendMessage("Bot", `No se pudo generar una respuesta: ${error.message}`);
    setStatus("Se produjo un error durante la generación.");
  } finally {
    setInputEnabled(true);
    inputEl.focus();
  }
});

async function init() {
  await assertCapabilities();
  await registerServiceWorker();
  await warmStaticCache();
  businessInfo = await loadBusinessInfo();
  webllm = await importWebLLM();
  engine = await loadModel();
  appendMessage("Bot", "Modelo y contexto listos. Ya podés consultar información del negocio.");
  setStatus("Listo para responder offline.");
  setInputEnabled(true);
  inputEl.focus();
}

async function assertCapabilities() {
  if (!window.isSecureContext) {
    throw new Error(
      `La app se abrió en un contexto no seguro (${window.location.origin}). WebGPU y la PWA offline solo funcionan en HTTPS o en http://localhost. Si abriste la app desde la red con una IP local por HTTP, eso bloquea WebGPU.`
    );
  }

  if (!("gpu" in navigator)) {
    throw new Error(
      "Este navegador no expone WebGPU. Probá con una versión reciente de Chrome, Edge o Safari y verificá que WebGPU esté habilitado."
    );
  }

  let adapter = null;

  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    throw new Error(`WebGPU existe pero falló al pedir el adaptador GPU: ${error.message}`);
  }

  if (!adapter) {
    throw new Error(
      "El navegador reconoce WebGPU, pero no pudo obtener un adaptador GPU. Revisá que la aceleración por hardware esté activa y que el navegador tenga soporte WebGPU real."
    );
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.register("./service-worker.js");
  await navigator.serviceWorker.ready;

  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
    });
  }

  console.log("Service worker listo:", registration.scope);
}

async function warmStaticCache() {
  if (!("caches" in window)) {
    return;
  }

  const cache = await caches.open("pwa-local-chat-app-v1");
  await cache.addAll(["./", "./index.html", "./app.js", "./manifest.json", BUSINESS_DOC_URL]);
}

async function loadBusinessInfo() {
  setStatus("Cargando información local del negocio...");
  const response = await fetch(BUSINESS_DOC_URL);

  if (!response.ok) {
    throw new Error("No se pudo cargar docs/negocio.txt");
  }

  return response.text();
}

async function importWebLLM() {
  setStatus("Cargando librería WebLLM...");
  const module = await import(WEBLLM_CDN_URL);
  return module;
}

async function loadModel() {
  setStatus("Cargando modelo en WebGPU...");

  const initProgressCallback = (progress) => {
    console.log("WebLLM:", progress);
    const text = progress.text || "Descargando e inicializando modelo...";
    setStatus(text);
  };

  const mlcEngine = new webllm.MLCEngine({ initProgressCallback });
  await mlcEngine.reload(MODEL_ID);
  return mlcEngine;
}

async function askBusinessAssistant(question) {
  const messages = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nInformación del negocio:\n${businessInfo}`,
    },
    {
      role: "user",
      content: `Pregunta del cliente: ${question}`,
    },
  ];

  const response = await engine.chat.completions.create({
    messages,
    temperature: 0.2,
    max_tokens: 220,
  });

  return response.choices?.[0]?.message?.content?.trim() || "No se dispone de esa información.";
}

function setInputEnabled(enabled) {
  inputEl.disabled = !enabled;
  sendButtonEl.disabled = !enabled;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function appendMessage(author, text) {
  const item = document.createElement("article");
  item.className = "message";
  item.innerHTML = `<strong>${author}:</strong><span>${escapeHtml(text)}</span>`;
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}