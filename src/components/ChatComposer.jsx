import { forwardRef, useEffect, useRef } from "react";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import { Box, CircularProgress, IconButton, Stack, TextField, Tooltip } from "@mui/material";

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
    <Stack
      component="form"
      direction={{ xs: "column", sm: "row" }}
      gap={1}
      onSubmit={onSubmit}
    >
      <TextField
        fullWidth
        inputRef={inputRef}
        label={downloading ? "Escribí tu consulta (se enviará cuando la IA esté lista)" : "Pregunta del cliente"}
        placeholder="Consultá horarios, dirección, pagos o promociones"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Tooltip title={downloading ? "Se enviará cuando la IA esté lista" : "Enviar (Enter)"} placement="top">
        <Box sx={{ alignSelf: { xs: "stretch", sm: "center" }, flexShrink: 0 }}>
          <IconButton
            aria-label="Enviar"
            disabled={!canSend}
            type="submit"
            sx={{
              width: { xs: "100%", sm: 48 },
              height: 48,
              bgcolor: canSend ? "primary.main" : "action.disabledBackground",
              color: canSend ? "white" : "action.disabled",
              borderRadius: { xs: 1, sm: "50%" },
              "&:hover": { bgcolor: "primary.dark", color: "white" },
              px: { xs: 1 },
            }}
          >
            {busy && !downloading ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              <SendRoundedIcon />
            )}
          </IconButton>
        </Box>
      </Tooltip>
    </Stack>
  );
});