import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";

export default function StatusPanel({ downloading, downloadPct, modelLabel, modelSize }) {
  if (!downloading) return null;
  const isCached = downloadPct === 100;
  const label = isCached ? "Inicializando" : "Descargando IA";
  const modelName = modelLabel ? `${modelLabel}${modelSize ? ` (${modelSize})` : ""}` : "modelo";
  const subtext = isCached
    ? "Modelo descargado. Inicializando en el dispositivo…"
    : downloadPct !== null
    ? `Descargando ${modelName} — solo la primera vez. (${downloadPct}%)`
    : `Preparando la descarga de ${modelName}…`;

  return (
    <Stack spacing={0.5} sx={{ minWidth: { xs: 0, sm: 220 }, maxWidth: 280 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          size="small"
          label={label}
          sx={{
            bgcolor: "warning.lighter",
            color: "warning.main",
            border: (theme) => `1px solid ${theme.vars?.palette?.warning?.light ?? theme.palette.warning.light}`,
          }}
        />
        {downloadPct !== null && !isCached && (
          <Typography variant="caption" color="text.secondary" fontWeight={500}>
            {downloadPct}%
          </Typography>
        )}
      </Stack>
      <LinearProgress
        variant={downloadPct !== null ? "determinate" : "indeterminate"}
        value={downloadPct ?? 0}
        sx={{ height: 6 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem", lineHeight: 1.35 }}>
        {subtext}
      </Typography>
    </Stack>
  );
}