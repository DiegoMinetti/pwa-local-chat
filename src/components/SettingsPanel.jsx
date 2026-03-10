import { useEffect, useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { AVAILABLE_MODELS, DEFAULT_CONFIG, buildContextPreview } from "../lib/chatbot";
import { getModelCompatibility } from "../lib/capabilities";
import { getRuntimeLabel } from "../lib/modelCatalog";

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

export default function SettingsPanel({
  open,
  onClose,
  config,
  onApply,
  engineLoading,
  browserSupport,
  deviceCapabilities,
  chatHistory = "",
  canSummarize = false,
  onSummarize,
}) {
  const [draft, setDraft] = useState(config);
  const [jsonValid, setJsonValid] = useState(true);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState("");

  // Reset draft to the current applied config every time the panel opens.
  useEffect(() => {
    if (open) {
      setDraft(config);
      validateJson(config.businessInfo);
      setSummarizeError("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "businessInfo") validateJson(value);
  }

  function validateJson(text) {
    if (!text?.trim()) { setJsonValid(true); return; }
    try { JSON.parse(text); setJsonValid(true); } catch { setJsonValid(false); }
  }

  async function handleSummarize() {
    if (!onSummarize || !draft.businessInfo?.trim()) return;
    setSummarizing(true);
    setSummarizeError("");
    try {
      let result = await onSummarize(draft.businessInfo);
      // Extract the JSON block in case the model added any preamble/postamble
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = jsonMatch[0];
      set("businessInfo", result);
    } catch (err) {
      setSummarizeError(err?.message || "Error al procesar con el modelo.");
    } finally {
      setSummarizing(false);
    }
  }

  const previewSections = buildContextPreview({
    systemPrompt: draft.systemPrompt,
    businessInfo: draft.businessInfo,
    chatHistory,
    additionalContexts: draft.additionalContexts,
  });
  const totalPreviewTokens = previewSections.reduce((s, sec) => s + sec.tokens, 0);

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
                onChange={(e) => {
                  const nextModelId = e.target.value;
                  setDraft((current) => ({
                    ...current,
                    modelId: nextModelId,
                    fallbackModelIds: (current.fallbackModelIds || []).filter((id) => id !== nextModelId),
                  }));
                }}
              >
                {AVAILABLE_MODELS.map((m) => {
                  const compatibility = browserSupport || deviceCapabilities
                    ? getModelCompatibility(m.id, browserSupport || deviceCapabilities)
                    : { compatible: true, reason: "Compatible." };
                  return (
                    <MenuItem key={m.id} value={m.id} disabled={!compatibility.compatible}>
                      <Box>
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          sx={{ opacity: compatibility.compatible ? 1 : 0.5 }}
                        >
                          {m.label} {!compatibility.compatible && "⚠️"}
                        </Typography>
                        <Typography
                          variant="caption"
                          color={compatibility.compatible ? "text.secondary" : "error"}
                        >
                          {getRuntimeLabel(m.runtime)} · {m.size} · {m.description}
                          {!compatibility.compatible && ` — ${compatibility.reason}`}
                        </Typography>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small" disabled={engineLoading} sx={{ mt: 1.25 }}>
              <InputLabel>Fallback automático</InputLabel>
              <Select
                multiple
                label="Fallback automático"
                value={draft.fallbackModelIds || []}
                onChange={(e) => set("fallbackModelIds", e.target.value)}
                renderValue={(selected) => {
                  if (!selected.length) return "Sin fallback";
                  return AVAILABLE_MODELS.filter((model) => selected.includes(model.id))
                    .map((model) => model.label)
                    .join(", ");
                }}
              >
                {AVAILABLE_MODELS.map((m) => {
                  const compatibility = browserSupport || deviceCapabilities
                    ? getModelCompatibility(m.id, browserSupport || deviceCapabilities)
                    : { compatible: true, reason: "Compatible." };
                  const disabled = m.id === draft.modelId || !compatibility.compatible;

                  return (
                    <MenuItem key={`fallback-${m.id}`} value={m.id} disabled={disabled}>
                      <Box>
                        <Typography variant="body2" fontWeight={500} sx={{ opacity: disabled ? 0.5 : 1 }}>
                          {m.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color={disabled && m.id !== draft.modelId ? "error" : "text.secondary"}
                        >
                          {getRuntimeLabel(m.runtime)} · {m.description}
                          {m.id === draft.modelId && " — Ya está como modelo principal"}
                          {disabled && m.id !== draft.modelId && ` — ${compatibility.reason}`}
                        </Typography>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
              Si el modelo principal no puede arrancar, la app probará estos modelos en orden.
            </Typography>
            {deviceCapabilities && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                Memoria del dispositivo: ~{deviceCapabilities.estimatedMemoryGB} GB
                {deviceCapabilities.isMobile && " (móvil)"}
              </Typography>
            )}
            {browserSupport?.runtimeSupport && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Backends disponibles: {browserSupport.runtimeSupport.webgpu ? "WebGPU" : "sin WebGPU"} · {browserSupport.runtimeSupport.wasm ? "WASM" : "sin WASM"}
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
                jsonValid
                  ? <CheckCircleRoundedIcon fontSize="small" color="success" />
                  : <ErrorRoundedIcon fontSize="small" color="error" />
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
            <Stack direction="row" spacing={1} alignItems="center" mt={1} flexWrap="wrap">
              <Tooltip
                title={
                  canSummarize
                    ? "Usa el modelo cargado para ordenar, corregir y resumir el JSON del negocio"
                    : "Cargá el modelo primero para usar esta función"
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canSummarize || !draft.businessInfo?.trim() || summarizing}
                    onClick={handleSummarize}
                    startIcon={
                      summarizing
                        ? <CircularProgress size={14} />
                        : <AutoFixHighRoundedIcon fontSize="small" />
                    }
                  >
                    {summarizing ? "Procesando…" : "Resumir con IA"}
                  </Button>
                </span>
              </Tooltip>
              {summarizeError && (
                <Typography variant="caption" color="error.main">
                  {summarizeError}
                </Typography>
              )}
            </Stack>
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

          {/* FUENTES EN TIEMPO REAL */}
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
              <Typography variant="overline" color="text.secondary">
                Fuentes en tiempo real (API)
              </Typography>
              <Tooltip title="Agregar endpoint en tiempo real (ej: /api/prices)">
                <IconButton
                  size="small"
                  onClick={() => {
                    const newSource = { name: "Nueva API", endpoint: "", enabled: true };
                    set("dynamicSources", [...(draft.dynamicSources || []), newSource]);
                  }}
                >
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>

            {draft.dynamicSources?.length > 0 ? (
              <Stack spacing={2}>
                {draft.dynamicSources.map((source, idx) => (
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
                          label="Nombre"
                          value={source.name}
                          onChange={(e) => {
                            const updated = [...draft.dynamicSources];
                            updated[idx].name = e.target.value;
                            set("dynamicSources", updated);
                          }}
                          placeholder="ej: Precios"
                          sx={{ flex: 1 }}
                        />
                        <Tooltip title="Eliminar fuente">
                          <IconButton
                            size="small"
                            onClick={() => {
                              set(
                                "dynamicSources",
                                draft.dynamicSources.filter((_, i) => i !== idx)
                              );
                            }}
                          >
                            <DeleteRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      <TextField
                        size="small"
                        fullWidth
                        label="Endpoint"
                        value={source.endpoint}
                        onChange={(e) => {
                          const updated = [...draft.dynamicSources];
                          updated[idx].endpoint = e.target.value;
                          set("dynamicSources", updated);
                        }}
                        placeholder="https://api.ejemplo.com/prices"
                        inputProps={{ style: { fontFamily: "monospace", fontSize: "0.85rem" } }}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={source.enabled !== false}
                            onChange={(e) => {
                              const updated = [...draft.dynamicSources];
                              updated[idx].enabled = e.target.checked;
                              set("dynamicSources", updated);
                            }}
                            size="small"
                          />
                        }
                        label="Activa"
                      />
                    </Stack>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Sin fuentes dinámicas. Agrega una API para actualizar precios, mesas u otros datos en tiempo real.
              </Typography>
            )}
          </Box>

          <Divider />

          {/* MOTOR */}
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

          <Divider />

          {/* VISTA DEL CONTEXTO ACTIVO */}
          <Box>
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1,
                "&:before": { display: "none" },
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <VisibilityRoundedIcon fontSize="small" color="action" />
                  <Typography variant="body2" fontWeight={600}>
                    Vista del contexto activo
                  </Typography>
                  <Chip
                    label={`${totalPreviewTokens.toLocaleString("es")} tokens`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: "0.7rem", height: 20 }}
                  />
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <Stack divider={<Divider />}>
                  {previewSections.map((sec) => (
                    <Box key={sec.label} sx={{ px: 2, py: 1.5 }}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        mb={0.5}
                      >
                        <Typography
                          variant="caption"
                          fontWeight={700}
                          color="text.secondary"
                          sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
                        >
                          {sec.label}
                        </Typography>
                        <Chip
                          label={`${sec.tokens.toLocaleString("es")} tk`}
                          size="small"
                          sx={{ fontSize: "0.65rem", height: 18 }}
                        />
                      </Stack>
                      <Box
                        component="pre"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          m: 0,
                          maxHeight: 160,
                          overflowY: "auto",
                          bgcolor: "action.hover",
                          borderRadius: 0.5,
                          p: 1,
                          color: "text.primary",
                        }}
                      >
                        {sec.content}
                      </Box>
                    </Box>
                  ))}
                  {previewSections.length === 0 && (
                    <Box sx={{ px: 2, py: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        Sin contexto configurado todavía.
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
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
