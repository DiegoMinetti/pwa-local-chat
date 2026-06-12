import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { appTheme } from "../theme";
import ChatComposer from "./ChatComposer";
import MessageList from "./MessageList";

// vitest 4 no corre el cleanup automático de RTL entre tests; lo forzamos.
afterEach(() => {
  cleanup();
});

function renderWithTheme(ui) {
  return render(<ThemeProvider theme={appTheme}>{ui}</ThemeProvider>);
}

function getComposerScope() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Composer form no encontrado en el DOM");
  return form;
}

function getComposerSendButton() {
  const buttons = within(getComposerScope()).getAllByRole("button");
  const sendButton = buttons.find((b) => b.getAttribute("aria-label") === "Enviar");
  if (!sendButton) throw new Error("Botón Enviar no encontrado");
  return sendButton;
}

describe("MessageList — M3 styling", () => {
  it("muestra la etiqueta 'Asistente' solo en mensajes del bot", () => {
    renderWithTheme(
      <MessageList
        messages={[
          { id: "1", author: "Bot", text: "Hola" },
          { id: "2", author: "Cliente", text: "Buen día" },
        ]}
      />
    );

    expect(screen.getByText("Asistente")).toBeInTheDocument();
    expect(screen.queryAllByText("Asistente")).toHaveLength(1);
  });

  it("renderiza 3 dots animados mientras el mensaje está pending", () => {
    renderWithTheme(
      <MessageList
        messages={[{ id: "1", author: "Bot", text: "...", pending: true }]}
      />
    );

    // El texto "..." nunca llega al DOM: MessageList detecta text === "..." y
    // renderiza dots en su lugar.
    expect(screen.queryByText("...")).not.toBeInTheDocument();
    // El contenedor de dots es un Box con 3 hijos directos.
    const botBubble = screen.getByText("Asistente").parentElement;
    const dotsWrapper = botBubble.querySelector("div > div");
    expect(dotsWrapper.children.length).toBe(3);
  });

  it("muestra el texto del bot con caret cuando streaming tiene contenido", () => {
    const { container } = renderWithTheme(
      <MessageList
        messages={[
          { id: "1", author: "Bot", text: "Respuesta parcial", streaming: true },
        ]}
      />
    );

    expect(screen.getByText("Respuesta parcial")).toBeInTheDocument();
    // El caret es un <span> dentro del <p>, indicador de streaming activo.
    const caret = container.querySelector("p > span");
    expect(caret).toBeInTheDocument();
  });

  it("muestra texto plano sin caret cuando el streaming terminó", () => {
    const { container } = renderWithTheme(
      <MessageList
        messages={[
          { id: "1", author: "Bot", text: "Respuesta final", streaming: false },
        ]}
      />
    );

    expect(screen.getByText("Respuesta final")).toBeInTheDocument();
    // Sin streaming, no debe haber un <span> hijo del <p> con el caret.
    const caret = container.querySelector("p > span");
    expect(caret).not.toBeInTheDocument();
  });

  it("preserva saltos de línea en el texto del bot", () => {
    const { container } = renderWithTheme(
      <MessageList
        messages={[{ id: "1", author: "Bot", text: "Línea 1\nLínea 2" }]}
      />
    );

    const text = screen.getByText(/Línea 1/);
    expect(text).toBeInTheDocument();
    // El textContent del contenedor preserva el \n (sx whiteSpace: pre-wrap
    // se aplica vía CSS, que jsdom no computa, pero el texto crudo
    // sigue en el DOM).
    expect(container.textContent).toContain("Línea 1\nLínea 2");
  });

  it("no muestra etiqueta 'Asistente' en mensajes del cliente", () => {
    renderWithTheme(
      <MessageList
        messages={[{ id: "1", author: "Cliente", text: "Hola" }]}
      />
    );

    expect(screen.queryByText("Asistente")).not.toBeInTheDocument();
    expect(screen.getByText("Hola")).toBeInTheDocument();
  });
});

describe("ChatComposer — M3 styling", () => {
  it("renderiza el input con aria-label accesible y placeholder M3", () => {
    renderWithTheme(
      <ChatComposer
        value=""
        downloading={false}
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const input = screen.getAllByLabelText(/pregunta del cliente/i).at(-1);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", expect.stringContaining("Escribí"));
  });

  it("cambia el placeholder mientras el modelo se descarga", () => {
    renderWithTheme(
      <ChatComposer
        value=""
        downloading
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    expect(
      screen.getByPlaceholderText(/se enviará cuando la IA esté lista/i)
    ).toBeInTheDocument();
  });

  it("deshabilita el botón enviar cuando el input está en blanco", () => {
    renderWithTheme(
      <ChatComposer
        value="   "
        downloading={false}
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    // canSend = value.trim().length > 0 → con whitespace, false.
    const button = getComposerSendButton();
    expect(button).toBeDisabled();
  });

  it("habilita el botón enviar cuando hay texto", () => {
    renderWithTheme(
      <ChatComposer
        value="Hola"
        downloading={false}
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    const button = getComposerSendButton();
    expect(button).toBeEnabled();
  });

  it("muestra CircularProgress cuando busy y NO está downloading", () => {
    const { container } = renderWithTheme(
      <ChatComposer
        value="Hola"
        downloading={false}
        busy
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    // MUI CircularProgress usa className "MuiCircularProgress-root".
    expect(container.querySelector(".MuiCircularProgress-root")).toBeInTheDocument();
  });

  it("muestra el SendRoundedIcon cuando NO está busy", () => {
    const { container } = renderWithTheme(
      <ChatComposer
        value="Hola"
        downloading={false}
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    // MUI icons usan data-testid con su nombre.
    expect(container.querySelector('[data-testid="SendRoundedIcon"]')).toBeInTheDocument();
  });

  it("forwardRef expone el ref al textarea element", () => {
    const ref = { current: null };
    renderWithTheme(
      <ChatComposer
        ref={ref}
        value=""
        downloading={false}
        busy={false}
        onChange={() => {}}
        onSubmit={() => {}}
      />
    );

    // useEffect setea ref.current al <textarea> interno tras montar.
    expect(ref.current).not.toBeNull();
  });
});
