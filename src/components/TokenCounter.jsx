import { Stack, Typography, Box, LinearProgress } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";

export default function TokenCounter({ contextTokens, responseTokens, totalTokens, maxTokens }) {
  const tokenPercentage = maxTokens ? Math.round((totalTokens / maxTokens) * 100) : 0;
  const isNearLimit = tokenPercentage > 80;
  const isOverLimit = tokenPercentage > 100;
  const saturated = isOverLimit;
  const clampedPct = Math.min(100, tokenPercentage);

  return (
    <Stack
      direction="column"
      spacing={1}
      sx={{
        p: 1.25,
        bgcolor: saturated
          ? "error.lighter"
          : isNearLimit
          ? "warning.lighter"
          : "info.lighter",
        borderRadius: 2,
        border: "1px solid",
        borderColor: saturated
          ? "error.light"
          : isNearLimit
          ? "warning.light"
          : "info.light",
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        useFlexGap
        flexWrap="wrap"
      >
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          Tokens:
        </Typography>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Contexto:
          </Typography>
          <Typography variant="caption" fontWeight={600} color="primary.main">
            {contextTokens.toLocaleString("es")}
          </Typography>
        </Box>

        <Box
          sx={{
            width: { xs: "1px", sm: "1px" },
            height: 14,
            bgcolor: "divider",
            display: { xs: "none", sm: "block" },
          }}
        />

        <Box>
          <Typography variant="caption" color="text.secondary">
            Respuesta (máx):
          </Typography>
          <Typography variant="caption" fontWeight={600} color="success.main">
            {responseTokens.toLocaleString("es")}
          </Typography>
        </Box>

        <Box
          sx={{
            width: { xs: "1px", sm: "1px" },
            height: 14,
            bgcolor: "divider",
            display: { xs: "none", sm: "block" },
          }}
        />

        <Box>
          <Typography variant="caption" color="text.secondary">
            Total:
          </Typography>
          <Typography
            variant="caption"
            fontWeight={700}
            color={saturated ? "error.main" : isNearLimit ? "warning.main" : "text.primary"}
          >
            {totalTokens.toLocaleString("es")} / {maxTokens.toLocaleString("es")}
          </Typography>
        </Box>

        <Box
          sx={{
            width: { xs: "1px", sm: "1px" },
            height: 14,
            bgcolor: "divider",
            display: { xs: "none", sm: "block" },
          }}
        />

        <Box>
          <Typography variant="caption" color="text.secondary">
            Uso:
          </Typography>
          <Typography
            variant="caption"
            fontWeight={700}
            color={saturated ? "error.main" : isNearLimit ? "warning.main" : "text.primary"}
          >
            {tokenPercentage}%
          </Typography>
        </Box>
      </Stack>

      {/* Barra M3 + mensaje contextual cuando se acerca al límite. */}
      <LinearProgress
        variant="determinate"
        value={clampedPct}
        color={saturated ? "error" : isNearLimit ? "warning" : "primary"}
        sx={{ height: 4, borderRadius: 999 }}
      />
      {saturated && (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <AutoAwesomeRoundedIcon sx={{ fontSize: 14 }} color="error" />
          <Typography variant="caption" color="error.main" fontWeight={600}>
            Contexto lleno. Se va a comprimir automáticamente con la próxima respuesta.
          </Typography>
        </Stack>
      )}
      {!saturated && isNearLimit && (
        <Typography variant="caption" color="warning.main" fontWeight={500}>
          Contexto casi lleno ({tokenPercentage}%). Se comprimirá automáticamente si se desborda.
        </Typography>
      )}
    </Stack>
  );
}
