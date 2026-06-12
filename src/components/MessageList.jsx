import { useEffect, useRef } from "react";
import { Box, Paper, Typography } from "@mui/material";

export default function MessageList({ messages }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, py: 1 }}>
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
    </Box>
  );
}
