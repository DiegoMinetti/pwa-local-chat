import { forwardRef, useEffect, useRef } from "react";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import { CircularProgress, IconButton, InputBase, Paper, Stack, Tooltip } from "@mui/material";

export default forwardRef(function ChatComposer({ value, downloading, busy, onChange, onSubmit }, ref) {
  const inputRef = useRef(null);

  // Expose input element to parent via ref
  useEffect(() => {
    if (ref) {
      ref.current = inputRef.current;
    }
  }, [ref]);

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && value.trim()) {
      event.preventDefault();
      onSubmit(event);
    }
  }

  const canSend = value.trim().length > 0;

  return (
    <Stack component="form" direction="row" alignItems="center" gap={1} onSubmit={onSubmit}>
      <Paper
        elevation={0}
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          px: 2.25,
          minHeight: 52,
          borderRadius: 999,
          bgcolor: "surfaceContainer.high",
          transition: "box-shadow 0.2s ease",
          "&:focus-within": {
            boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}`,
          },
        }}
      >
        <InputBase
          fullWidth
          inputRef={inputRef}
          multiline
          maxRows={4}
          placeholder={
            downloading
              ? "Escribí tu consulta (se enviará cuando la IA esté lista)"
              : "Escribí tu consulta…"
          }
          inputProps={{ "aria-label": "Pregunta del cliente" }}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ py: 1.25, fontSize: "1rem" }}
        />
      </Paper>
      <Tooltip title={downloading ? "Se enviará cuando la IA esté lista" : "Enviar (Enter)"} placement="top">
        <span>
          <IconButton
            aria-label="Enviar"
            disabled={!canSend}
            type="submit"
            sx={{
              width: 52,
              height: 52,
              flexShrink: 0,
              bgcolor: canSend ? "primary.main" : "surfaceContainer.high",
              color: canSend ? "primary.contrastText" : "text.disabled",
              transition: "background-color 0.2s ease, transform 0.15s ease",
              "&:hover": { bgcolor: canSend ? "primary.dark" : "surfaceContainer.highest" },
              "&:active": { transform: "scale(0.92)" },
              "&.Mui-disabled": {
                bgcolor: "surfaceContainer.high",
                color: "text.disabled",
              },
            }}
          >
            {busy && !downloading ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              <SendRoundedIcon />
            )}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
});
