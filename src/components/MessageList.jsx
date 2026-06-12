import { useEffect, useRef, useState, useCallback } from "react";
import { Box, ButtonBase, Paper, Typography } from "@mui/material";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";

// Umbral en píxeles para considerar que el usuario está "al fondo" del scroll.
// Evita falsos negativos cuando el último mensaje termina 1-2px antes del
// borde por el redondeo del browser.
const STICKY_BOTTOM_THRESHOLD = 40;

function isScrolledToBottom(el, threshold = STICKY_BOTTOM_THRESHOLD) {
  if (!el) return true; // sin contenedor, asumimos "abajo" para no trabar el flujo
  return el.scrollHeight - el.clientHeight - el.scrollTop <= threshold;
}

export default function MessageList({ messages, scrollRef }) {
  const endRef = useRef(null);
  // Track de la posición del usuario antes de cada cambio de mensajes.
  // Se actualiza en cada `useEffect` con el valor leído del contenedor
  // scrolleable antes del render. El siguiente render consume esa lectura.
  const wasAtBottomRef = useRef(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  // Sincroniza el flag de "abajo" con el scroll del contenedor. Se dispara
  // también en resize, focus del input, y cuando el contenido cambia de
  // tamaño (ResizeObserver sobre el sentinel `endRef`).
  const updateStickyState = useCallback(() => {
    const el = scrollRef?.current;
    if (!el) return;
    if (isScrolledToBottom(el)) {
      // Si llega al fondo solo, también limpiamos el aviso.
      setHasNewBelow(false);
    }
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    el.addEventListener("scroll", updateStickyState, { passive: true });
    // ResizeObserver para cuando el alto del contenedor cambia (teclado
    // móvil, rotación, mensaje nuevo que aumenta scrollHeight).
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateStickyState);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", updateStickyState);
      ro?.disconnect();
    };
  }, [scrollRef, updateStickyState]);

  // Cada vez que cambian los mensajes: si el usuario estaba al fondo,
  // scrollear al final. Si NO estaba al fondo, mostrar el aviso.
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el || !endRef.current) return;

    if (wasAtBottomRef.current) {
      // Sticky bottom: el usuario está siguiendo el chat, scrolleo suave.
      // requestAnimationFrame evita el "salto" cuando el DOM aún no terminó
      // de mutar (los nuevos mensajes todavía no tienen altura final).
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        setHasNewBelow(false);
      });
    } else {
      // El usuario está leyendo más arriba: NO lo movemos. Marcamos el aviso.
      setHasNewBelow(true);
    }
  }, [messages, scrollRef]);

  // Antes de cada cambio, capturamos si el usuario estaba al fondo. Esto
  // se ejecuta como effect de "limpieza" del render anterior, justo antes
  // de que el próximo setMessages pinte el cambio. Usamos un layout effect
  // para leer el estado del DOM después del commit anterior.
  useEffect(() => {
    const el = scrollRef?.current;
    wasAtBottomRef.current = isScrolledToBottom(el);
  });

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setHasNewBelow(false);
  }, []);

  return (
    <Box sx={{ position: "relative", display: "flex", flexDirection: "column", gap: 1, py: 1 }}>
      {messages.map((message) => {
        const isBot = message.author === "Bot";
        const isPending = Boolean(message.pending);
        const isStreaming = Boolean(message.streaming);
        const hasText = Boolean(message.text) && message.text !== "...";
        const showDots = isPending || (isStreaming && !hasText);

        return (
          <Box
            key={message.id}
            sx={{
              display: "flex",
              justifyContent: isBot ? "flex-start" : "flex-end",
              px: 1,
              animation: "msgIn 0.25s ease-out",
              "@keyframes msgIn": {
                from: { opacity: 0, transform: "translateY(8px)" },
                to: { opacity: 1, transform: "translateY(0)" },
              },
            }}
          >
            <Paper
              elevation={0}
              sx={{
                maxWidth: { xs: "86%", sm: "70%" },
                px: 2,
                py: 1.25,
                bgcolor: isBot ? "surfaceContainer.high" : "primary.container",
                color: isBot ? "text.primary" : "primary.onContainer",
                borderRadius: isBot ? "6px 20px 20px 20px" : "20px 6px 20px 20px",
              }}
            >
              {isBot && (
                <Typography
                  variant="caption"
                  fontWeight={600}
                  sx={{ display: "block", mb: 0.25, opacity: 0.55 }}
                >
                  Asistente
                </Typography>
              )}
              {showDots ? (
                <Box sx={{ display: "flex", gap: "5px", alignItems: "center", height: 22 }}>
                  {[0, 1, 2].map((i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        bgcolor: "text.disabled",
                        animation: "chatDot 1.2s infinite ease-in-out",
                        animationDelay: `${i * 0.2}s`,
                        "@keyframes chatDot": {
                          "0%, 80%, 100%": { transform: "scale(0.7)", opacity: 0.4 },
                          "40%": { transform: "scale(1)", opacity: 1 },
                        },
                      }}
                    />
                  ))}
                </Box>
              ) : (
                <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                  {message.text}
                  {isStreaming && (
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        width: "2px",
                        height: "1em",
                        ml: "2px",
                        verticalAlign: "text-bottom",
                        bgcolor: "primary.main",
                        animation: "caretBlink 0.9s steps(1) infinite",
                        "@keyframes caretBlink": {
                          "50%": { opacity: 0 },
                        },
                      }}
                    />
                  )}
                </Typography>
              )}
            </Paper>
          </Box>
        );
      })}
      <div ref={endRef} />

      {/* Botón flotante «nueva respuesta abajo» — aparece cuando el usuario
          está leyendo más arriba y llegó un mensaje nuevo. Se desmonta del
          DOM cuando no aplica (en vez de fade), así el a11y tree queda limpio. */}
      {hasNewBelow && (
        <ButtonBase
          onClick={scrollToBottom}
          aria-label="Bajar a la última respuesta"
          sx={{
            position: "sticky",
            bottom: 12,
            alignSelf: "center",
            mt: -5, // flota sobre el contenido, no ocupa flujo
            borderRadius: 999,
            px: 1.5,
            py: 0.75,
            gap: 0.5,
            display: "inline-flex",
            alignItems: "center",
            bgcolor: "primary.main",
            color: "primary.contrastText",
            boxShadow:
              "0 2px 6px rgba(32, 27, 19, 0.18), 0 1px 2px rgba(32, 27, 19, 0.12)",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
            "&:hover": {
              bgcolor: "primary.dark",
              boxShadow:
                "0 4px 10px rgba(32, 27, 19, 0.22), 0 2px 4px rgba(32, 27, 19, 0.14)",
            },
            "&:active": { transform: "scale(0.96)" },
          }}
        >
          <KeyboardArrowDownRoundedIcon fontSize="small" />
          <Typography variant="caption" fontWeight={600} sx={{ lineHeight: 1 }}>
            Nueva respuesta
          </Typography>
        </ButtonBase>
      )}
    </Box>
  );
}
