import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  cssVariables: true,
  shape: {
    borderRadius: 24
  },
  palette: {
    primary: {
      main: "#155eef"
    },
    secondary: {
      main: "#0f766e"
    },
    // `lighter` es una shade custom usada por TokenCounter; sin esto el fondo no renderiza.
    info: {
      lighter: "#eff8ff",
      light: "#b2ddff",
      main: "#155eef"
    },
    success: {
      lighter: "#edfcf2",
      light: "#a6f4c5",
      main: "#16a34a"
    },
    warning: {
      lighter: "#fffaeb",
      light: "#fedf89",
      main: "#f79009"
    },
    error: {
      lighter: "#fef3f2",
      light: "#fda29b",
      main: "#f04438"
    },
    background: {
      default: "#edf2ff",
      paper: "#ffffff"
    }
  },
  typography: {
    fontFamily: '"Google Sans", "Roboto", sans-serif',
    h3: {
      fontWeight: 700,
      letterSpacing: "-0.04em"
    },
    h5: {
      fontWeight: 700,
      letterSpacing: "-0.02em"
    }
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 28
        }
      }
    },
    MuiButton: {
      defaultProps: {
        variant: "contained"
      },
      styleOverrides: {
        root: {
          borderRadius: 18,
          minHeight: 48,
          textTransform: "none",
          fontWeight: 700
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined"
      }
    }
  }
});