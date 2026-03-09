import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { appTheme } from "./theme";
import "./index.css";

registerSW({
  immediate: true,
  onOfflineReady() {
    console.log("La PWA ya tiene recursos locales listos para uso offline.");
  },
  onNeedRefresh() {
    console.log("Hay una nueva versión disponible para la PWA.");
  }
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);