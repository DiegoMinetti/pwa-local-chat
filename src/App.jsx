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
      "¡Hola! Seleccioná un modelo en configuración para empezar."
    ),
  ]);
  const [question, setQuestion] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadPct, setDownloadPct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const [chatHistory, setChatHistory] = useState("");
  const [tokenInfo, setTokenInfo] = useState({ contextTokens: 0, responseTokens: 0, totalTokens: 0 });

  // Ref for the composer wrapper (used when fixing the composer over mobile keyboard)
  const composerWrapperRef = useRef(null);

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

    async function checkCapabilities() {
      const support = await assessBrowserSupport();
      if (cancelled) return;
      
      if (!support.supported) {
        setError(support.message);
        setMessages([makeMsg("Bot", `Error: ${support.message}`)]);
        return;
      }
      
      setDeviceCapabilities(support.deviceCapabilities);
      
      // Load business info
      try {
        const businessDoc = await loadBusinessDocument();
        setConfig((c) => {
          const updated = { ...c, businessInfo: businessDoc };
          try {
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
          } catch (err) {
            console.warn('Failed to save config:', err);
          }
          return updated;
        });
      } catch (err) {
        console.error('Failed to load business document:', err);
      }
    }

    checkCapabilities();

    return () => {
      cancelled = true;
    };
  }, []);

  // Bootstrap engine only when user applies settings with a valid model
  useEffect(() => {
    if (bootKey === 0) return; // Don't run on initial mount
    
    let cancelled = false;
    const snapshot = configRef.current;

    async function bootstrap() {
      setDownloading(true);
      setDownloadPct(null);
      setError("");
      setMessages([makeMsg("Bot", "Cargando modelo, por favor esperá un momento…")]);

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
  }, [processQueue, bootKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Box sx={{ position: 'relative', px: { xs: 2, md: 3 }, pt: { xs: 1.75, md: 2.25 }, pb: 1.25, flexShrink: 0 }}>
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
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ position: 'absolute', top: { xs: '8px', md: '16px' }, right: { xs: '8px', md: '16px' } }}
              >
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
              bottom: { xs: 'var(--keyboard-offset, env(safe-area-inset-bottom, 0px))' },
              zIndex: { xs: 1300 },
              backgroundColor: { xs: 'rgba(255,255,255,0.96)', sm: 'transparent' },
              borderTop: (theme) => `1px solid ${theme.palette.divider}`,
            }}
          >
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
          </Box>
        </Card>
      </Container>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onApply={applySettings}
        engineLoading={downloading}
        deviceCapabilities={deviceCapabilities}
      />
    </Box>
  );
}
