import { Stack, Typography, Box } from "@mui/material";

export default function TokenCounter({ contextTokens, responseTokens, totalTokens, maxTokens }) {
  const tokenPercentage = maxTokens ? Math.round((totalTokens / maxTokens) * 100) : 0;
  const isNearLimit = tokenPercentage > 80;
  const isOverLimit = tokenPercentage > 100;

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      alignItems={{ xs: "flex-start", sm: "center" }}
      sx={{
        p: 1,
        bgcolor: isOverLimit ? "error.lighter" : isNearLimit ? "warning.lighter" : "info.lighter",
        borderRadius: 1,
        border: "1px solid",
        borderColor: isOverLimit ? "error.light" : isNearLimit ? "warning.light" : "info.light",
      }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={500}>
        Tokens:
      </Typography>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 1, sm: 2 }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        useFlexGap
        sx={{ width: "100%" }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary">
            Contexto:
          </Typography>
          <Typography variant="caption" fontWeight={600} color="primary">
            {contextTokens.toLocaleString("es")}
          </Typography>
        </Box>

        <Box sx={{ width: { xs: "100%", sm: "1px" }, height: { xs: "1px", sm: 16 }, bgcolor: "divider" }} />

        <Box>
          <Typography variant="caption" color="text.secondary">
            Respuesta (máx):
          </Typography>
          <Typography variant="caption" fontWeight={600} color="success.main">
            {responseTokens.toLocaleString("es")}
          </Typography>
        </Box>

        <Box sx={{ width: { xs: "100%", sm: "1px" }, height: { xs: "1px", sm: 16 }, bgcolor: "divider" }} />

        <Box>
          <Typography variant="caption" color="text.secondary">
            Total:
          </Typography>
          <Typography
            variant="caption"
            fontWeight={700}
            color={isOverLimit ? "error.main" : isNearLimit ? "warning.main" : "text.primary"}
          >
            {totalTokens.toLocaleString("es")} / {maxTokens.toLocaleString("es")}
          </Typography>
        </Box>

        <Box sx={{ width: { xs: "100%", sm: "1px" }, height: { xs: "1px", sm: 16 }, bgcolor: "divider" }} />

        <Box>
          <Typography variant="caption" color="text.secondary">
            Uso:
          </Typography>
          <Typography
            variant="caption"
            fontWeight={700}
            color={isOverLimit ? "error.main" : isNearLimit ? "warning.main" : "text.primary"}
          >
            {tokenPercentage}%
          </Typography>
        </Box>
      </Stack>
    </Stack>
  );
}
