import { useCallback, useEffect, useRef, useState } from "react";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  Chip,
  Container,
  IconButton,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ChatComposer from "./components/ChatComposer";
import MessageList from "./components/MessageList";
import SettingsPanel from "./components/SettingsPanel";
import StatusPanel from "./components/StatusPanel";
import TokenCounter from "./components/TokenCounter";
import { assessBrowserSupport, getModelCompatibility, getRecommendedSettings } from "./lib/capabilities";
import {
  DEFAULT_CONFIG,
  calculateContextTokens,
  calculateMessagesTokens,
  computeHistoryBudget,
  createEngine,
  estimateContextOverflow,
  estimateTokens,
  fetchDynamicContexts,
  generateChatSummary,
  loadModelRuntimeModule,
  loadBusinessDocument,
  quickLookup,
  sanitizeStreamingText,
  streamAssistantReply,
  SUGGESTED_QUESTIONS,
  summarizeBusinessInfo,
  summarizeChatWithModel,
} from "./lib/chatbot";
import { getConfiguredModelIds, getModelById, getRuntimeLabel } from "./lib/modelCatalog";

let nextId = 1;
const newId = () => String(nextId++);

const CONFIG_STORAGE_KEY = 'cafe-central-config';
const NO_MODEL_WARNING = "El asistente con IA no está disponible en este momento. Igual puedo responder al instante las preguntas frecuentes, o podés revisar la Configuración.";
const WELCOME_MESSAGE = "¡Hola! Soy el asistente de Café Central. ¿En qué puedo ayudarte?";

function makeMsg(author, text, extra = {}) {
  return { id: newId(), author, text, ...extra };
}

export default function App() {
  const engineRef = useRef(null);
  const activeModelIdRef = useRef(null);
  const pendingQueueRef = useRef([]); // [{ question, botMsgId }]
  const processingRef = useRef(false);
  const inputRef = useRef(null); // Chat input reference for global keyboard capture

  const [messages, setMessages] = useState([makeMsg("Bot", WELCOME_MESSAGE)]);
  const [question, setQuestion] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadPct, setDownloadPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [browserSupport, setBrowserSupport] = useState(null);
  const [deviceCapabilities, setDeviceCapabilities] = useState(null);
  const [config, setConfig] = useState(() => {
    // Load saved config from localStorage
    try {
      const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with DEFAULT_CONFIG to ensure all keys exist
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      console.warn('Failed to load saved config:', err);
    }
    return DEFAULT_CONFIG;
  });
  const [bootKey, setBootKey] = useState(0);
  const [isFirstBootstrap, setIsFirstBootstrap] = useState(() => {
    try {
      const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
      return !saved; // true if no saved config
    } catch {
      return true;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingModelInfo, setLoadingModelInfo] = useState(null); // { label, size }
  const [chatHistory, setChatHistory] = useState("");
  const [compressionNotice, setCompressionNotice] = useState(""); // toast de auto-compresión
  const messagesRef = useRef(null); // snapshot de messages para compresión async
  messagesRef.current = messages;
  const [tokenInfo, setTokenInfo] = useState({ contextTokens: 0, responseTokens: 0, totalTokens: 0 });
  const [showTokenDetails, setShowTokenDetails] = useState(false);

  // Ref for the composer wrapper (used when fixing the composer over mobile keyboard)
  const composerWrapperRef = useRef(null);
  const messagesScrollRef = useRef(null); // Scroll container de la lista de mensajes

  // Always-current config ref — lets callbacks read latest config without stale closures.
  const configRef = useRef(DEFAULT_CONFIG);
  configRef.current = config;
  
  // Always-current chat history ref
  const chatHistoryRef = useRef("");
  chatHistoryRef.current = chatHistory;

  // Update token info when question or config changes
  useEffect(() => {
    const tokens = calculateMessagesTokens({
      systemPrompt: configRef.current.systemPrompt,
      businessInfo: configRef.current.businessInfo,
      question,
      chatHistory,
      additionalContexts: configRef.current.additionalContexts || [],
      responseLength: configRef.current.maxTokens, // potential max response
      contextWindowSize: configRef.current.contextWindowSize,
    });
    setTokenInfo(tokens);
  }, [question, config, chatHistory]);

  // Auto-clear del aviso de compresión después de 4s. Lo separamos del
  // setCompressionNotice para que el clear sea independiente del flujo.
  useEffect(() => {
    if (!compressionNotice) return undefined;
    const t = setTimeout(() => setCompressionNotice(""), 4000);
    return () => clearTimeout(t);
  }, [compressionNotice]);

  // Global keyboard capture: focus input and capture first keystroke if not already focused
  useEffect(() => {
    function handleGlobalKeyDown(event) {
      // Ignore if input is already focused or settings are open
      if (document.activeElement === inputRef.current || settingsOpen) {
        return;
      }

      // Ignore modifier keys and special keys
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key === "Escape" ||
        event.key === "Tab" ||
        event.key === "Shift" ||
        event.key === "Control" ||
        event.key === "Alt" ||
        event.key === "Meta"
      ) {
        return;
      }

      // Ignore if clicking on an input-like element
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.contentEditable === "true"
      ) {
        return;
      }

      // Focus input and insert character (but not Enter, which triggers submit)
      if (event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();

      // Simulate the keystroke in the input by updating the question state
      if (inputRef.current) {
        setQuestion((prev) => prev + event.key);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [settingsOpen]);

  // Keep composer visible above the on-screen keyboard on mobile by
  // updating a CSS variable with the keyboard inset using visualViewport.
  useEffect(() => {
    function updateKeyboardOffset() {
      try {
        const vv = window.visualViewport;
        if (!vv) {
          document.documentElement.style.setProperty('--keyboard-offset', '0px');
          return;
        }

        // When the on-screen keyboard is visible, visualViewport.height shrinks.
        // Compute the difference between layout viewport and visual viewport.
        const inset = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
        document.documentElement.style.setProperty('--keyboard-offset', `${inset}px`);
      } catch (e) {
        // ignore
      }
    }

    updateKeyboardOffset();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKeyboardOffset);
      window.visualViewport.addEventListener('scroll', updateKeyboardOffset);
    } else {
      window.addEventListener('resize', updateKeyboardOffset);
    }

    // Also reset on blur / orientation change (keyboard dismissed)
    window.addEventListener('orientationchange', updateKeyboardOffset);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateKeyboardOffset);
        window.visualViewport.removeEventListener('scroll', updateKeyboardOffset);
      } else {
        window.removeEventListener('resize', updateKeyboardOffset);
      }
      window.removeEventListener('orientationchange', updateKeyboardOffset);
      document.documentElement.style.removeProperty('--keyboard-offset');
    };
  }, []);

  async function releaseCurrentEngine() {
    const currentEngine = engineRef.current;
    if (!currentEngine) return;

    try {
      if (typeof currentEngine.interruptGenerate === "function") {
        currentEngine.interruptGenerate();
      }
    } catch (err) {
      console.warn("Failed to interrupt current generation:", err);
    }

    try {
      if (typeof currentEngine.unload === "function") {
        await currentEngine.unload();
      }
    } catch (err) {
      console.warn("Failed to unload previous model:", err);
    } finally {
      engineRef.current = null;
    }
  }

  async function maybeClearOldModelCache(previousModelId, nextModelId) {
    if (!previousModelId || previousModelId === nextModelId) return;

    const previousModel = getModelById(previousModelId);
    if (previousModel?.runtime !== "webllm") return;

    const isMobileDevice =
      deviceCapabilities?.isMobile ??
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );

    if (!isMobileDevice) return;

    try {
      const webllm = await import("@mlc-ai/web-llm");
      if (typeof webllm.deleteModelAllInfoInCache === "function") {
        await webllm.deleteModelAllInfoInCache(previousModelId);
      }
    } catch (err) {
      // Cache cleanup is best-effort and should not block model switching.
      console.warn("Failed to clear old model cache:", err);
    }
  }

  // Keep chat content visible by reserving space equal to composer height on mobile.
  useEffect(() => {
    function updateComposerHeight() {
      const el = composerWrapperRef.current;
      const height = el ? Math.ceil(el.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty("--composer-height", `${height}px`);
    }

    updateComposerHeight();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateComposerHeight)
        : null;

    if (observer && composerWrapperRef.current) {
      observer.observe(composerWrapperRef.current);
    }

    window.addEventListener("resize", updateComposerHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateComposerHeight);
      document.documentElement.style.removeProperty("--composer-height");
    };
  }, []);

  function updateMsg(id, patch) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }

  // Ref para evitar que se acumulen compresiones con modelo concurrentes.
  const compressingRef = useRef(false);

  /**
   * Recalcula el resumen del historial. Estrategia híbrida:
   *  1. Genera un resumen ligero con rolling window (sin modelo).
   *  2. Si el total de tokens (con ese resumen) entra en la ventana, lo aplica.
   *  3. Si NO entra, dispara una compresión con modelo en background
   *     (summarizeChatWithModel) y actualiza el historial cuando termina.
   *  4. Si la compresión con modelo falla, deja el resumen ligero igual.
   *
   * Devuelve una promesa que se resuelve cuando el resumen ligero está listo;
   * la compresión con modelo puede completarse después.
   */
  const refreshChatHistory = useCallback(async ({ messagesAfter = null, forceModel = false } = {}) => {
    // 1. Resumen ligero (rolling window) con budget dinámico.
    const budget = computeHistoryBudget(configRef.current);
    const baseSummary = generateChatSummary(
      messagesAfter,
      budget,
      { recentPairsToKeep: 3, maxResponseChars: 240, maxQuestionChars: 120 }
    );
    setChatHistory(baseSummary);
    chatHistoryRef.current = baseSummary;

    // 2. Chequeo de overflow con el resumen ya aplicado.
    const tokensAfter = calculateMessagesTokens({
      systemPrompt: configRef.current.systemPrompt,
      businessInfo: configRef.current.businessInfo,
      question: "",
      chatHistory: baseSummary,
      additionalContexts: configRef.current.additionalContexts || [],
      responseLength: configRef.current.maxTokens,
      contextWindowSize: configRef.current.contextWindowSize,
    });
    const overflow = estimateContextOverflow(tokensAfter, configRef.current.contextWindowSize);

    // Si no hay overflow y no nos forzaron, listo.
    if (!overflow.overflow && !forceModel) return;

    // 3. Overflow → compresión con modelo. Guard contra re-entry.
    if (compressingRef.current) return;
    compressingRef.current = true;

    // Tomamos snapshot de los mensajes para el modelo.
    const snapshot = messagesAfter
      ? messagesAfter
      : // Si no se pasaron, leemos el state actual vía closure (best effort).
        null;

    // Si no tenemos snapshot directo, hacemos una lectura no-reactiva vía
    // el ref. Necesitamos que `messagesRef` exista; lo creamos a continuación.
    const msgsForModel = snapshot ?? messagesRef.current;

    summarizeChatWithModel(engineRef.current, msgsForModel, {
      temperature: 0.1,
      topP: 0.85,
      repetitionPenalty: 1.1,
    })
      .then((compressed) => {
        if (compressed) {
          setChatHistory(compressed);
          chatHistoryRef.current = compressed;
          // Toast sutil: el usuario ve que pasó algo.
          setCompressionNotice("Contexto comprimido para liberar espacio.");
        } else {
          // El modelo falló → mantenemos el ligero. Igual avisamos que intentamos.
          setCompressionNotice("No se pudo comprimir con el modelo; se mantuvo resumen ligero.");
        }
      })
      .catch(() => {
        // Silencioso: el resumen ligero ya está aplicado.
      })
      .finally(() => {
        compressingRef.current = false;
        // Auto-clear del aviso después de unos segundos (lo hace el componente).
      });
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current || !engineRef.current) return;
    processingRef.current = true;

    while (pendingQueueRef.current.length > 0) {
      const { question: q, botMsgId } = pendingQueueRef.current.shift();
      setBusy(true);
      updateMsg(botMsgId, { text: "", pending: false, streaming: true });

      try {
        // Pre-fetch dynamic contexts so the first streamed token arrives sooner.
        const dynamicResult = await fetchDynamicContexts(configRef.current.dynamicSources || []);
        const allDynamicContexts = dynamicResult.contexts;
        const staticContexts = configRef.current.additionalContexts || [];

        if (dynamicResult.errors.length > 0) {
          const failed = dynamicResult.errors.map((e) => e.name).join(", ");
          setError(`No se pudo actualizar en tiempo real: ${failed}. Se usará la última información disponible.`);
        }

        const config = {
          ...configRef.current,
          chatHistory: chatHistoryRef.current,
          additionalContexts: [...staticContexts, ...allDynamicContexts],
        };

        // Streaming real: actualizamos el bot message con el texto sanitizado
        // acumulado a cada token. Esto activa el caret blink y la animación
        // de reveal progresivo en MessageList. Se aplica throttling con rAF
        // para no inundar React con renders a 30+ tokens/segundo.
        let lastFlushedText = "";
        let pendingFlush = null;
        const hasRaf = typeof requestAnimationFrame === "function";
        const flush = () => {
          pendingFlush = null;
          updateMsg(botMsgId, { text: lastFlushedText });
        };
        const scheduleFlush = (accumulated) => {
          lastFlushedText = sanitizeStreamingText(accumulated);
          if (pendingFlush !== null) return;
          pendingFlush = hasRaf ? requestAnimationFrame(flush) : setTimeout(flush, 0);
        };

        const finalText = await streamAssistantReply(
          engineRef.current,
          configRef.current.businessInfo,
          q,
          scheduleFlush,
          config
        );
        if (pendingFlush !== null) {
          if (hasRaf) cancelAnimationFrame(pendingFlush);
          else clearTimeout(pendingFlush);
        }
        // Show complete sanitized text and stop streaming flag (drops the caret).
        updateMsg(botMsgId, { text: finalText, streaming: false });

        // Compresión de historial (ligera + overflow check + forzada con
        // modelo si hace falta). El cálculo es local y sincrónico; la
        // compresión con modelo es async pero corre en background y actualiza
        // el historial cuando termina, sin trabar la próxima pregunta.
        setMessages((current) => {
          // Calculamos el resumen sobre la lista YA actualizada con la
          // respuesta del bot. Devolvemos `current` sin modificar para no
          // causar un re-render extra.
          refreshChatHistory({ messagesAfter: current, forceModel: false });
          return current;
        });
      } catch (err) {
        console.error("Reply error:", err);
        updateMsg(botMsgId, {
          text: "Lo siento, ocurrió un error. Por favor intentá de nuevo.",
          streaming: false,
        });
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }

    processingRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkCapabilities() {
      const support = await assessBrowserSupport();
      if (cancelled) return;
      
      if (!support.supported) {
        setError(support.message);
        setMessages([makeMsg("Bot", `Error: ${support.message}`)]);
        return;
      }

      setBrowserSupport(support);
      setDeviceCapabilities(support.deviceCapabilities);
      if (support.message !== "Entorno WebGPU listo.") {
        setError(support.message);
      }

      // Ask the browser to keep our storage (model weights) from being purged
      // under disk pressure — critical on iOS, where Safari evicts caches.
      try {
        navigator.storage?.persist?.();
      } catch {
        // best-effort only
      }

      // Load business info
      let businessDoc = "";
      try {
        businessDoc = await loadBusinessDocument();
      } catch (err) {
        console.error('Failed to load business document:', err);
      }
      if (cancelled) return;

      // First visit: pick the best model for this device automatically so the
      // assistant starts without requiring any configuration from the user.
      const recommended = isFirstBootstrap ? getRecommendedSettings(support) : null;

      setConfig((c) => {
        const updated = {
          ...c,
          ...(recommended || {}),
          ...(businessDoc ? { businessInfo: businessDoc } : {}),
        };
        try {
          localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
        } catch (err) {
          console.warn('Failed to save config:', err);
        }
        return updated;
      });

      // Start loading the model right away (saved config or recommended one).
      setBootKey((k) => (k === 0 ? 1 : k));
    }

    checkCapabilities();

    return () => {
      cancelled = true;
    };
  }, []);

  // Bootstrap engine only when user applies settings with a valid model
  useEffect(() => {
    if (bootKey === 0 || !browserSupport) return; // Don't run on initial mount
    
    let cancelled = false;
    const snapshot = configRef.current;

    async function bootstrap() {
      setDownloading(true);
      setDownloadPct(null);
      setError("");
      setMessages([
        makeMsg("Bot", WELCOME_MESSAGE),
        makeMsg(
          "Bot",
          "Estoy preparando la IA en tu dispositivo (la descarga se hace una sola vez). Mientras tanto respondo al instante las preguntas frecuentes de abajo."
        ),
      ]);

      const previousModelId = activeModelIdRef.current;
      await releaseCurrentEngine();

      const attempts = [];
      let selectedModel = null;
      let engine = null;

      for (const candidateModelId of getConfiguredModelIds(snapshot)) {
        const compatibility = getModelCompatibility(candidateModelId, browserSupport);
        const model = getModelById(candidateModelId);

        if (!compatibility.compatible) {
          attempts.push(`${model?.label || candidateModelId}: ${compatibility.reason}`);
          continue;
        }

        try {
          setLoadingModelInfo({ label: model?.label, size: model?.size });
          await maybeClearOldModelCache(previousModelId, candidateModelId);
          const runtimeModule = await loadModelRuntimeModule(candidateModelId);
          engine = await createEngine(
            runtimeModule,
            (progress) => {
              if (cancelled) return;
              const pct =
                typeof progress.progress === "number"
                  ? Math.round(progress.progress * 100)
                  : null;
              setDownloadPct(pct);
            },
            {
              modelId: candidateModelId,
              contextWindowSize: snapshot.contextWindowSize,
              preferredBackend: compatibility.backend,
            }
          );
          selectedModel = { ...model, backend: compatibility.backend };
          break;
        } catch (err) {
          attempts.push(`${model?.label || candidateModelId}: ${err.message}`);
        }
      }

      if (!engine || !selectedModel) {
        throw new Error(`No se pudo cargar ningún modelo configurado. ${attempts.join(" | ")}`);
      }

      if (cancelled) {
        await engine.unload?.();
        return;
      }

      engineRef.current = engine;
      activeModelIdRef.current = selectedModel.id;
      setDownloading(false);
      setLoadingModelInfo(null);

      if (selectedModel.id !== snapshot.modelId) {
        setError(
          `Se cargó automáticamente ${selectedModel.label} en ${getRuntimeLabel(selectedModel.runtime)} porque el modelo principal no era compatible o falló al iniciar.`
        );
      } else if (browserSupport.message !== "Entorno WebGPU listo.") {
        setError(browserSupport.message);
      }

      if (isFirstBootstrap) {
        setIsFirstBootstrap(false);
        setSettingsOpen(false);
      }
      setMessages((current) => [
        ...current,
        makeMsg("Bot", "¡Listo! Ya puedo responder cualquier consulta sobre Café Central."),
      ]);
      processQueue();
    }

    bootstrap().catch((err) => {
      if (cancelled) return;
      console.error("No se pudo inicializar la app:", err);
      setDownloading(false);
      setLoadingModelInfo(null);
      setError(err.message);
      setMessages((current) => [
        ...current,
        makeMsg("Bot", `Error de inicialización: ${err.message}`),
      ]);
    });

    return () => {
      cancelled = true;
    };
  }, [processQueue, bootKey, browserSupport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Release GPU resources when leaving the page/app.
  useEffect(() => {
    return () => {
      releaseCurrentEngine();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // submitQuestion handles both quick (text-search) and queued (model) paths.
  function submitQuestion(text) {
    const cleanQuestion = text.trim();
    if (!cleanQuestion) return;

    setQuestion("");
    setError("");

    // Instant path first: keyword lookup on the business document answers the
    // most common questions immediately, with zero tokens and zero invention.
    if (configRef.current.businessInfo) {
      const quick = quickLookup(configRef.current.businessInfo, cleanQuestion);
      if (quick) {
        setMessages((current) => {
          const next = [...current, makeMsg("Cliente", cleanQuestion), makeMsg("Bot", quick)];
          // Comprimir historial (ligero + check overflow con modelo).
          refreshChatHistory({ messagesAfter: next, forceModel: false });
          return next;
        });
        return;
      }
    }

    // No model loaded and none on the way: surface the configuration flow.
    if (!engineRef.current && !downloading) {
      handleMissingModelWarning();
      return;
    }

    const botMsgId = newId();
    setMessages((current) => [
      ...current,
      makeMsg("Cliente", cleanQuestion),
      { id: botMsgId, author: "Bot", text: "...", pending: true },
    ]);

    pendingQueueRef.current.push({ question: cleanQuestion, botMsgId });
    processQueue();
  }

  function handleSubmit(event) {
    event.preventDefault();
    submitQuestion(question);
  }

  function handleMissingModelWarning() {
    setError(NO_MODEL_WARNING);
    setSettingsOpen(true);
  }

  function handleCloseSettings() {
    setSettingsOpen(false);
    if (!engineRef.current && !downloading) {
      setError(NO_MODEL_WARNING);
    }
  }

  function applySettings(newConfig) {
    const needsRestart =
      newConfig.modelId !== config.modelId ||
      JSON.stringify(newConfig.fallbackModelIds || []) !== JSON.stringify(config.fallbackModelIds || []) ||
      newConfig.contextWindowSize !== config.contextWindowSize;

    const normalizedConfig = {
      ...newConfig,
      fallbackModelIds: Array.isArray(newConfig.fallbackModelIds) ? newConfig.fallbackModelIds : [],
      dynamicSources: Array.isArray(newConfig.dynamicSources) ? newConfig.dynamicSources : [],
    };
    
    // Save to localStorage
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalizedConfig));
    } catch (err) {
      console.warn('Failed to save config:', err);
    }
    
    setConfig(normalizedConfig);
    setSettingsOpen(false);
    
    if (needsRestart) {
      if (typeof engineRef.current?.interruptGenerate === "function") {
        try {
          engineRef.current.interruptGenerate();
        } catch (err) {
          console.warn("Failed to interrupt generation while switching model:", err);
        }
      }
      processingRef.current = false;
      pendingQueueRef.current = [];
      setBootKey((k) => k + 1); // Trigger bootstrap
    } else if (bootKey === 0) {
      // First time applying settings, trigger initial bootstrap
      setBootKey(1);
    }
    
    // Mark first bootstrap as complete
    if (isFirstBootstrap) {
      setIsFirstBootstrap(false);
    }
  }

  return (
    <Box
      sx={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        // Fondo M3 cálido: gradiente radial sutil sobre surfaceContainer.low
        // para que el panel central levante visualmente sin glassmorphism.
        // Usamos los tokens de palette con fallback a vars para que funcione
        // tanto con cssVariables: true como en tests sin ThemeProvider.
        background: (theme) => {
          const surface = theme.vars?.palette?.surfaceContainer?.low ?? theme.palette.surfaceContainer?.low;
          const bg = theme.vars?.palette?.background?.default ?? theme.palette.background.default;
          return `radial-gradient(circle at 50% 0%, ${surface} 0%, ${bg} 55%)`;
        },
      }}
    >
      <Container
        maxWidth="md"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          py: { xs: 1, md: 2 },
          px: { xs: 1, sm: 2, md: 3 },
        }}
      >
        <Card
          elevation={0}
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            // M3 tonal elevation: surfaceContainer alto, sin borde duro ni blur.
            backgroundColor: "surfaceContainer.lowest",
            border: (theme) => `1px solid ${theme.vars?.palette?.divider ?? theme.palette.divider}`,
            boxShadow: (theme) =>
              "0 1px 2px rgba(32, 27, 19, 0.06), 0 1px 3px rgba(32, 27, 19, 0.04)",
          }}
        >
          {/* Header — M3 sticky surfaceContainer con divider inferior sutil. */}
          <Box
            sx={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              px: { xs: 2, md: 3 },
              pt: { xs: 1.5, md: 2 },
              pb: 1.25,
              flexShrink: 0,
              bgcolor: "surfaceContainer.low",
              borderBottom: (theme) => `1px solid ${theme.vars?.palette?.divider ?? theme.palette.divider}`,
            }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              gap={1}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
                <Typography component="h1" variant="h5" noWrap>
                  Asistente de Café Central
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                <StatusPanel
                  downloading={downloading}
                  downloadPct={downloadPct}
                  modelLabel={loadingModelInfo?.label}
                  modelSize={loadingModelInfo?.size}
                />
                <Tooltip title="Configuración">
                  <IconButton
                    size="small"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="abrir configuración"
                  >
                    <SettingsRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>

          {error ? (
            <Box sx={{ px: { xs: 2, md: 3 }, pb: 1, flexShrink: 0 }}>
              <Alert severity="warning" onClose={() => setError("")}>{error}</Alert>
            </Box>
          ) : null}

          {/* Suggested questions: visible until the customer asks something */}
          {(downloading || !messages.some((m) => m.author === "Cliente")) && (
            <Box sx={{ px: { xs: 2, md: 3 }, pb: 1, flexShrink: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
                Preguntas frecuentes — respuesta al instante:
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <Chip
                    key={q}
                    label={q}
                    size="small"
                    clickable
                    variant="outlined"
                    onClick={() => submitQuestion(q)}
                  />
                ))}
              </Stack>
            </Box>
          )}

          {/* Scrollable messages */}
          <Box
            ref={messagesScrollRef}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              px: { xs: 1, md: 2 },
              pb: {
                xs: "calc(var(--composer-height, 96px) + env(safe-area-inset-bottom, 0px))",
                sm: 0,
              },
            }}
          >
            {(tokenInfo.contextTokens > 0 || tokenInfo.responseTokens > 0) && (
              <Accordion
                disableGutters
                expanded={showTokenDetails}
                onChange={(_, expanded) => setShowTokenDetails(expanded)}
                sx={{
                  mb: 1,
                  borderRadius: 2,
                  border: (theme) => `1px solid ${theme.vars?.palette?.divider ?? theme.palette.divider}`,
                  backgroundColor: "surfaceContainer.lowest",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                  <Typography variant="body2" fontWeight={600}>
                    Estadisticas de tokens
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <TokenCounter
                    contextTokens={tokenInfo.contextTokens}
                    responseTokens={tokenInfo.responseTokens}
                    totalTokens={tokenInfo.totalTokens}
                    maxTokens={config.contextWindowSize}
                  />
                </AccordionDetails>
              </Accordion>
            )}
            <MessageList messages={messages} scrollRef={messagesScrollRef} />
          </Box>

          {/* Composer */}
          <Box
            ref={composerWrapperRef}
            sx={{
              px: { xs: 2, md: 3 },
              pt: 1.5,
              pb: { xs: 2, md: 2.25 },
              flexShrink: 0,
              position: { xs: 'fixed', sm: 'static' },
              left: { xs: 0 },
              right: { xs: 0 },
              bottom: { xs: 'calc(var(--keyboard-offset, 0px) + env(safe-area-inset-bottom, 0px))' },
              zIndex: { xs: 1300 },
              backgroundColor: { xs: 'rgba(255,255,255,0.96)', sm: 'transparent' },
              borderTop: { xs: (theme) => `1px solid ${theme.palette.divider}`, sm: "none" },
            }}
          >
            <ChatComposer
              ref={inputRef}
              busy={busy}
              downloading={downloading}
              onChange={setQuestion}
              onSubmit={handleSubmit}
              value={question}
            />
          </Box>
        </Card>
      </Container>
      <SettingsPanel
        open={settingsOpen}
        onClose={handleCloseSettings}
        config={config}
        onApply={applySettings}
        engineLoading={downloading}
        browserSupport={browserSupport}
        deviceCapabilities={deviceCapabilities}
        chatHistory={chatHistory}
        canSummarize={!downloading && !busy && !!engineRef.current}
        onSummarize={async (rawText) => {
          if (!engineRef.current) throw new Error("Modelo no cargado");
          return summarizeBusinessInfo(engineRef.current, rawText, configRef.current);
        }}
      />
      {/* Toast sutil cuando el historial se auto-comprime con el modelo. */}
      <Snackbar
        open={Boolean(compressionNotice)}
        autoHideDuration={4000}
        onClose={() => setCompressionNotice("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoAwesomeRoundedIcon fontSize="small" />
            <Typography variant="body2">{compressionNotice}</Typography>
          </Stack>
        }
        ContentProps={{
          sx: {
            bgcolor: "primary.main",
            color: "primary.contrastText",
            borderRadius: 2,
          },
        }}
      />
    </Box>
  );
}
