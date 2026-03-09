import { useCallback, useEffect, useRef, useState } from "react";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import {
  Alert,
  Box,
  Card,
  Chip,
  Container,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ChatComposer from "./components/ChatComposer";
import MessageList from "./components/MessageList";
import SettingsPanel from "./components/SettingsPanel";
import StatusPanel from "./components/StatusPanel";
import TokenCounter from "./components/TokenCounter";
import { assessBrowserSupport } from "./lib/capabilities";
import {
  DEFAULT_CONFIG,
  calculateContextTokens,
  calculateMessagesTokens,
  createEngine,
  estimateTokens,
  generateChatSummary,
  loadBusinessDocument,
  quickLookup,
  streamAssistantReply,
  SUGGESTED_QUESTIONS,
} from "./lib/chatbot";

let nextId = 1;
const newId = () => String(nextId++);

const CONFIG_STORAGE_KEY = 'cafe-central-config';

function makeMsg(author, text, extra = {}) {
  return { id: newId(), author, text, ...extra };
}

export default function App() {
  const engineRef = useRef(null);
  const pendingQueueRef = useRef([]); // [{ question, botMsgId }]
  const processingRef = useRef(false);
  const inputRef = useRef(null); // Chat input reference for global keyboard capture

  const [messages, setMessages] = useState([
    makeMsg(
      "Bot",
      "¡Hola! Estoy cargando la IA. Podés escribir tu consulta ahora y la responderé en cuanto esté lista."
    ),
  ]);
  const [question, setQuestion] = useState("");
  const [downloading, setDownloading] = useState(true);
  const [downloadPct, setDownloadPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const [chatHistory, setChatHistory] = useState("");
  const [tokenInfo, setTokenInfo] = useState({ contextTokens: 0, responseTokens: 0, totalTokens: 0 });

  // Always-current config ref — lets callbacks read latest config without stale closures.
  const configRef = useRef(DEFAULT_CONFIG);
  configRef.current = config;
  
  // Always-current chat history ref
  const chatHistoryRef = useRef("");
  chatHistoryRef.current = chatHistory;

  // Open settings panel on first load (no saved config)
  useEffect(() => {
    if (isFirstBootstrap) {
      setSettingsOpen(true);
    }
  }, [isFirstBootstrap]);

  // Update token info when question or config changes
  useEffect(() => {
    const tokens = calculateMessagesTokens({
      systemPrompt: configRef.current.systemPrompt,
      businessInfo: configRef.current.businessInfo,
      question,
      chatHistory,
      additionalContexts: configRef.current.additionalContexts || [],
      responseLength: configRef.current.maxTokens, // potential max response
    });
    setTokenInfo(tokens);
  }, [question, config, chatHistory]);

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

  function updateMsg(id, patch) {
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }

  const processQueue = useCallback(async () => {
    if (processingRef.current || !engineRef.current) return;
    processingRef.current = true;

    while (pendingQueueRef.current.length > 0) {
      const { question: q, botMsgId } = pendingQueueRef.current.shift();
      setBusy(true);
      updateMsg(botMsgId, { text: "", pending: false, streaming: true });

      try {
        // Accumulate text without showing intermediate updates
        const config = {
          ...configRef.current,
          chatHistory: chatHistoryRef.current,
        };
        
        const finalText = await streamAssistantReply(
          engineRef.current,
          configRef.current.businessInfo,
          q,
          () => {}, // no-op callback — don't update during streaming
          config
        );
        // Show complete text at once
        updateMsg(botMsgId, { text: finalText, streaming: false });
        
        // Update chat history after bot responds
        setMessages((current) => {
          const newHistory = generateChatSummary(current);
          setChatHistory(newHistory);
          chatHistoryRef.current = newHistory;
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
    const snapshot = configRef.current; // snapshot config at effect-run time

    async function bootstrap() {
      const support = await assessBrowserSupport();
      if (!support.supported) throw new Error(support.message);

      const businessDoc = await loadBusinessDocument();
      setConfig((c) => {
        const updated = { ...c, businessInfo: businessDoc };
        // Save to localStorage
        try {
          localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
        } catch (err) {
          console.warn('Failed to save config:', err);
        }
        return updated;
      });

      const webllm = await import("@mlc-ai/web-llm");
      const engine = await createEngine(
        webllm,
        (progress) => {
          if (cancelled) return;
          const pct =
            typeof progress.progress === "number"
              ? Math.round(progress.progress * 100)
              : null;
          setDownloadPct(pct);
        },
        {
          modelId: snapshot.modelId,
          contextWindowSize: snapshot.contextWindowSize,
        }
      );

      if (cancelled) return;

      engineRef.current = engine;
      setDownloading(false);
      if (isFirstBootstrap) {
        setIsFirstBootstrap(false);
        setSettingsOpen(false);
      }
      setMessages((current) => [
        ...current,
        makeMsg("Bot", "¡Listo! Soy el asistente de Cafe Central. ¿En qué puedo ayudarte?"),
      ]);
      processQueue();
    }

    bootstrap().catch((err) => {
      if (cancelled) return;
      console.error("No se pudo inicializar la app:", err);
      setDownloading(false);
      setError(err.message);
      setMessages((current) => [
        ...current,
        makeMsg("Bot", `Error de inicialización: ${err.message}`),
      ]);
    });

    return () => {
      cancelled = true;
    };
  }, [processQueue, bootKey, isFirstBootstrap]); // eslint-disable-line react-hooks/exhaustive-deps

  // submitQuestion handles both quick (text-search) and queued (model) paths.
  function submitQuestion(text) {
    const cleanQuestion = text.trim();
    if (!cleanQuestion) return;

    setQuestion("");
    setError("");

    // While engine is still loading, try an instant text-search answer.
    if (!engineRef.current && configRef.current.businessInfo) {
      const quick = quickLookup(configRef.current.businessInfo, cleanQuestion);
      if (quick) {
        setMessages((current) => [
          ...current,
          makeMsg("Cliente", cleanQuestion),
          makeMsg("Bot", quick),
        ]);
        return;
      }
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

  function applySettings(newConfig) {
    const needsRestart =
      newConfig.modelId !== config.modelId ||
      newConfig.contextWindowSize !== config.contextWindowSize;
    
    // Save to localStorage
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(newConfig));
    } catch (err) {
      console.warn('Failed to save config:', err);
    }
    
    setConfig(newConfig);
    setSettingsOpen(false);
    if (needsRestart) {
      engineRef.current = null;
      processingRef.current = false;
      pendingQueueRef.current = [];
      setDownloading(true);
      setDownloadPct(null);
      setError("");
      setMessages([makeMsg("Bot", "Cargando nuevo modelo, por favor esperá un momento…")]);
      setBootKey((k) => k + 1);
    }
  }

  return (
    <Box
      sx={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(circle at top, rgba(104, 161, 255, 0.16), transparent 30%), linear-gradient(180deg, #eef4ff 0%, #f8fafc 100%)",
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
            border: (theme) => `1px solid ${theme.palette.divider}`,
            backdropFilter: "blur(12px)",
            backgroundColor: "rgba(255,255,255,0.92)",
          }}
        >
          {/* Header */}
          <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 1.75, md: 2.25 }, pb: 1.25, flexShrink: 0 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
              gap={1}
              flexWrap="wrap"
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography component="h1" variant="h5">
                  Asistente de Cafe Central
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <StatusPanel downloading={downloading} downloadPct={downloadPct} />
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

          {/* Suggested questions during model load */}
          {downloading && (
            <Box sx={{ px: { xs: 2, md: 3 }, pb: 1, flexShrink: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
                Preguntas frecuentes — respondé al instante:
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
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 1, md: 2 } }}>
            <MessageList messages={messages} />
          </Box>

          {/* Composer */}
          <Box sx={{ px: { xs: 2, md: 3 }, pt: 1.5, pb: { xs: 2, md: 2.25 }, flexShrink: 0 }}>
            <ChatComposer
              ref={inputRef}
              busy={busy}
              downloading={downloading}
              onChange={setQuestion}
              onSubmit={handleSubmit}
              onQuickQuestion={submitQuestion}
              value={question}
            />
            
            {/* Token Counter */}
            {(tokenInfo.contextTokens > 0 || tokenInfo.responseTokens > 0) && (
              <Box sx={{ mt: 1.5 }}>
                <TokenCounter
                  contextTokens={tokenInfo.contextTokens}
                  responseTokens={tokenInfo.responseTokens}
                  totalTokens={tokenInfo.totalTokens}
                  maxTokens={config.contextWindowSize}
                />
              </Box>
            )}
            
            <Typography color="text.secondary" variant="caption" sx={{ display: "block", mt: 0.75 }}>
              Requiere HTTPS o localhost para WebGPU. Usá GitHub Pages para producción.
            </Typography>
          </Box>
        </Card>
      </Container>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onApply={applySettings}
        engineLoading={downloading}
      />
    </Box>
  );
}
