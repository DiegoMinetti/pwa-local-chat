import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";

export default function StatusPanel({ downloading, downloadPct }) {
  if (!downloading) return null;
  const isCached = downloadPct === 100;
  const label = isCached ? "Compilando" : "Descargando IA";
  const subtext = isCached
    ? "El modelo ya está en caché. Compilando shaders..."
    : downloadPct !== null
    ? `Descargando... Solo se hace una vez. (${downloadPct}%)`
    : "Cargando modelo desde caché local...";

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