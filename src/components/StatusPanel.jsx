import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";

export default function StatusPanel({ downloading, downloadPct }) {
  if (!downloading) return null;
  const isCached = downloadPct === 100;
  const label = isCached ? "Inicializando" : "Descargando IA";
  const subtext = isCached
    ? "Modelo descargado. Inicializando en el dispositivo…"
    : downloadPct !== null
    ? `Descargando modelo… Solo se hace una vez. (${downloadPct}%)`
    : "Preparando la descarga del modelo…";

  return (
    <Stack spacing={0.5} sx={{ minWidth: 200 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip size="small" color="warning" label={label} />
        {downloadPct !== null && !isCached && (
          <Typography variant="caption" color="text.secondary">
            {downloadPct}%
          </Typography>
        )}
      </Stack>
      <LinearProgress
        variant={downloadPct !== null ? "determinate" : "indeterminate"}
        value={downloadPct ?? 0}
        sx={{ borderRadius: 1, height: 5 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.68rem" }}>
        {subtext}
      </Typography>
    </Stack>
  );
}