import { createTheme } from "@mui/material/styles";

// Tema Material Design 3 (M3) con paleta tonal cálida acorde a la marca de la
// cafetería. Los tokens `container` / `onContainer` siguen el esquema de color
// M3 y se consumen desde sx como "primary.container", etc.
export const appTheme = createTheme({
  cssVariables: true,
  shape: {
    borderRadius: 16
  },
  palette: {
    primary: {
      main: "#805610",
      dark: "#5C3D00",
      light: "#A37C3F",
      contrastText: "#ffffff",
      container: "#FFDDB1",
      onContainer: "#291800"
    },
    secondary: {
      main: "#6F5B40",
      dark: "#564428",
      light: "#9A8465",
      contrastText: "#ffffff",
      container: "#FADEBC",
      onContainer: "#271904"
    },
    // `lighter` es una shade custom usada por TokenCounter; sin esto el fondo no renderiza.
    info: {
      lighter: "#FFF3E3",
      light: "#EDD3AC",
      main: "#805610"
    },
    success: {
      lighter: "#edfcf2",
      light: "#a6f4c5",
      main: "#2e7d32"
    },
    warning: {
      lighter: "#fffaeb",
      light: "#fedf89",
      main: "#f79009"
    },
    error: {
      lighter: "#FFEDEA",
      light: "#FFDAD6",
      main: "#BA1A1A"
    },
    background: {
      default: "#FFF8F2",
      paper: "#FFFBF7"
    },
    // Tonos de superficie M3 (surface container) para burbujas y paneles.
    surfaceContainer: {
      lowest: "#FFFFFF",
      low: "#FDF2E5",
      main: "#F7ECDF",
      high: "#F1E7D9",
      highest: "#ECE1D4"
    },
    text: {
      primary: "#201B13",
      secondary: "#4F4539"
    },
    divider: "#E3D9CC"
  },
  typography: {
    fontFamily: '"Google Sans", "Roboto", sans-serif',
    h3: {
      fontWeight: 700,
      letterSpacing: "-0.04em"
    },
    h5: {
      fontWeight: 600,
      letterSpacing: "-0.01em"
    },
    body1: {
      lineHeight: 1.55
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
        variant: "contained",
        disableElevation: true
      },
      styleOverrides: {
        root: {
          borderRadius: 999,
          minHeight: 48,
          paddingLeft: 24,
          paddingRight: 24,
          textTransform: "none",
          fontWeight: 600
        }
      }
    },
    MuiIconButton: {
      styleOverrides: {
        sizeSmall: {
          width: 40,
          height: 40
        },
        root: {
          width: 48,
          height: 48
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        // Chips M3: esquinas de 8dp, altura cómoda para el pulgar.
        root: {
          borderRadius: 10,
          fontWeight: 500
        },
        sizeSmall: {
          height: 36,
          fontSize: "0.8125rem"
        },
        outlined: {
          borderColor: "#E3D9CC",
          backgroundColor: "#FFFFFF",
          "&:hover": {
            backgroundColor: "#F7ECDF"
          }
        }
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 16
        }
      }
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          "&:before": { display: "none" }
        }
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 28
        }
      }
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 6,
          backgroundColor: "#F1E7D9"
        },
        bar: {
          borderRadius: 999
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined"
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 8
        }
      }
    }
  }
});
