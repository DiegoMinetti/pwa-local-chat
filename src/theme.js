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