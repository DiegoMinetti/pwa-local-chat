import { useEffect, useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import {
  Box,
  Button,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { AVAILABLE_MODELS, DEFAULT_CONFIG } from "../lib/chatbot";
import { isModelCompatible } from "../lib/capabilities";

function SliderRow({ label, hint, value, ...rest }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        <Typography variant="caption" color="primary.main" fontWeight={700}>
          {value}
        </Typography>
      </Stack>
      <Slider size="small" value={value} {...rest} />
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: "block" }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export default function SettingsPanel({ open, onClose, config, onApply, engineLoading, deviceCapabilities }) {
  const [draft, setDraft] = useState(config);
  const [jsonValid, setJsonValid] = useState(true);

  // Reset draft to the current applied config every time the panel opens.
  useEffect(() => {
    if (open) {
      setDraft(config);
      validateJson(config.businessInfo);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "businessInfo") validateJson(value);
  }

  function validateJson(text) {
    if (!text?.trim()) {
      setJsonValid(true);
      return;
    }
    try {
      JSON.parse(text);
      setJsonValid(true);
    } catch {
      setJsonValid(false);
    }
  }

  const requiresRestart =
    draft.modelId !== config.modelId ||
    draft.contextWindowSize !== config.contextWindowSize;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 400 }, display: "flex", flexDirection: "column" },
      }}
    >
      {/* ── Header ── */}
      <Box
        sx={{
          px: 2.5,
          py: 1.75,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <SettingsRoundedIcon fontSize="small" color="primary" />
          <Typography variant="h6" fontWeight={700}>
            Configuración
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} aria-label="cerrar configuración">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      <Divider />

      {/* ── Body ── */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2.5 }}>
        <Stack spacing={3.5}>

          {/* MODELO */}
          <Box>
            <Typography variant="overline" color="text.secondary" display="block" mb={1}>
              Modelo
            </Typography>
            <FormControl fullWidth size="small" disabled={engineLoading}>
              <InputLabel>Modelo de IA</InputLabel>
              <Select
                label="Modelo de IA"
                value={draft.modelId}
                onChange={(e) => set("modelId", e.target.value)}
              >
                {AVAILABLE_MODELS.map((m) => {
                  const compatible = deviceCapabilities 
                    ? isModelCompatible(m.id, deviceCapabilities) 
                    : true;
                  
                  return (
                    <MenuItem key={m.id} value={m.id} disabled={!compatible}>
                      <Box>
                        <Typography 
                          variant="body2" 
                          fontWeight={500}
                          sx={{ opacity: compatible ? 1 : 0.5 }}
                        >
                          {m.label} {!compatible && "⚠️"}
                        </Typography>
                        <Typography 
                          variant="caption" 
                          color={compatible ? "text.secondary" : "error"}
                        >
                          {m.size}
                          {!compatible && " — Requiere más memoria"}
                        </Typography>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            {deviceCapabilities && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                Memoria del dispositivo: ~{deviceCapabilities.estimatedMemoryGB} GB
                {deviceCapabilities.isMobile && " (móvil)"}
              </Typography>
            )}
          </Box>

          <Divider />

          {/* ROL DEL ASISTENTE */}
          <Box>
            <Typography variant="overline" color="text.secondary" display="block" mb={1}>
              Rol del asistente
            </Typography>
            <TextField
              multiline
              rows={6}
              fullWidth
              size="small"
              label="System prompt"
              value={draft.systemPrompt}
              onChange={(e) => set("systemPrompt", e.target.value)}
              inputProps={{ "aria-label": "system prompt" }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              Define la personalidad, el idioma y los límites de comportamiento.
            </Typography>
          </Box>

          <Divider />

          {/* PARÁMETROS DE GENERACIÓN */}
          <Box>
            <Typography variant="overline" color="text.secondary" display="block" mb={1.5}>
              Parámetros de generación
            </Typography>
            <Stack spacing={3}>
              <SliderRow
                label="Temperatura"
                hint="0 = determinístico · 1 = balanceado · 2 = muy creativo"
                min={0}
                max={2}
                step={0.05}
                value={draft.temperature}
                onChange={(_, v) => set("temperature", v)}
              />
              <SliderRow
                label="Top P"
                hint="Muestreo por núcleo — recomendado: 0.80 – 0.95"
                min={0.1}
                max={1}
                step={0.05}
                value={draft.topP}
                onChange={(_, v) => set("topP", v)}
              />
              <SliderRow
                label="Tokens máximos"
                hint="Longitud máxima de la respuesta generada"
                min={64}
                max={512}
                step={16}
                value={draft.maxTokens}
                onChange={(_, v) => set("maxTokens", v)}
              />
              <SliderRow
                label="Penalización por repetición"
                hint="Reduce la repetición de palabras — recomendado: 1.0 – 1.2"
                min={1.0}
                max={1.5}
                step={0.05}
                value={draft.repetitionPenalty}
                onChange={(_, v) => set("repetitionPenalty", v)}
              />
            </Stack>
          </Box>

          <Divider />

          {/* INFORMACIÓN DEL NEGOCIO */}
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <Typography variant="overline" color="text.secondary">
                Información del negocio (JSON)
              </Typography>
              {draft.businessInfo?.trim() && (
                jsonValid ? (
                  <CheckCircleRoundedIcon fontSize="small" color="success" />
                ) : (
                  <ErrorRoundedIcon fontSize="small" color="error" />
                )
              )}
            </Stack>
            <TextField
              multiline
              rows={10}
              fullWidth
              size="small"
              label="Negocio (JSON)"
              value={draft.businessInfo}
              onChange={(e) => set("businessInfo", e.target.value)}
              error={!jsonValid}
              helperText={
                !jsonValid
                  ? "JSON inválido — el asistente no podrá responder correctamente."
                  : "Contenido del archivo negocio.txt. Debe ser JSON válido."
              }
              inputProps={{
                "aria-label": "información del negocio",
                style: { fontFamily: "monospace", fontSize: "0.85rem" },
              }}
            />
          </Box>

          <Divider />

          {/* CONTEXTOS ADICIONALES */}
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
              <Typography variant="overline" color="text.secondary">
                Contextos adicionales
              </Typography>
              <Tooltip title="Agregar nuevo contexto (ej: precios, mesas disponibles)">
                <IconButton
                  size="small"
                  onClick={() => {
                    const newContext = { name: "Nuevo contexto", content: "" };
                    set("additionalContexts", [...(draft.additionalContexts || []), newContext]);
                  }}
                >
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>

            {draft.additionalContexts?.length > 0 ? (
              <Stack spacing={2}>
                {draft.additionalContexts.map((ctx, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      p: 1.5,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      bgcolor: "action.hover",
                    }}
                  >
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <TextField
                          size="small"
                          label="Nombre del contexto"
                          value={ctx.name}
                          onChange={(e) => {
                            const updated = [...draft.additionalContexts];
                            updated[idx].name = e.target.value;
                            set("additionalContexts", updated);
                          }}
                          placeholder="ej: Precios, Mesas"
                          sx={{ flex: 1 }}
                        />
                        <Tooltip title="Eliminar contexto">
                          <IconButton
                            size="small"
                            onClick={() => {
                              set(
                                "additionalContexts",
                                draft.additionalContexts.filter((_, i) => i !== idx)
                              );
                            }}
                          >
                            <DeleteRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      <TextField
                        multiline
                        rows={4}
                        fullWidth
                        size="small"
                        label="Contenido (JSON o texto)"
                        value={ctx.content}
                        onChange={(e) => {
                          const updated = [...draft.additionalContexts];
                          updated[idx].content = e.target.value;
                          set("additionalContexts", updated);
                        }}
                        placeholder="{}"
                        inputProps={{
                          style: { fontFamily: "monospace", fontSize: "0.85rem" },
                        }}
                      />
                    </Stack>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Sin contextos adicionales. Agrega uno con el botón +.
              </Typography>
            )}
          </Box>

          <Divider />
          <Box>
            <Typography variant="overline" color="text.secondary" display="block" mb={1}>
              Motor
            </Typography>
            <FormControl fullWidth size="small" disabled={engineLoading}>
              <InputLabel>Ventana de contexto</InputLabel>
              <Select
                label="Ventana de contexto"
                value={draft.contextWindowSize}
                onChange={(e) => set("contextWindowSize", e.target.value)}
              >
                {[2048, 4096, 8192].map((n) => (
                  <MenuItem key={n} value={n}>
                    {n.toLocaleString("es")} tokens
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {requiresRestart && (
              <Typography variant="caption" color="warning.main" sx={{ mt: 0.75, display: "block" }}>
                ⚠ Cambiar el modelo o la ventana de contexto reiniciará el motor de IA.
              </Typography>
            )}
          </Box>

        </Stack>
      </Box>

      <Divider />

      {/* ── Footer ── */}
      <Box sx={{ px: 2.5, py: 2, flexShrink: 0 }}>
        <Stack direction="row" spacing={1.5} justifyContent="space-between" alignItems="center">
          <Tooltip title="Restaurar valores predeterminados">
            <Button
              variant="text"
              color="inherit"
              size="small"
              startIcon={<RestartAltRoundedIcon />}
              onClick={() => setDraft(DEFAULT_CONFIG)}
            >
              Restablecer
            </Button>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            disableElevation
            onClick={() => onApply(draft)}
            color={requiresRestart ? "warning" : "primary"}
            disabled={!jsonValid}
          >
            {requiresRestart ? "Aplicar y reiniciar" : "Aplicar"}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
