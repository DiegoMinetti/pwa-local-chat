# pwa-local-chat

## Objetivo

Aplicación React + PWA para responder preguntas sobre un negocio usando únicamente información local cargada desde `public/docs/negocio.txt` y un modelo pequeño ejecutado en el navegador con WebLLM y WebGPU.

## Stack actual

- React 19 + Vite 7.
- Material UI 7 con una interfaz simple y responsive.
- WebLLM como dependencia instalada del proyecto.
- PWA gestionada con `vite-plugin-pwa`.
- Tests locales con Vitest + React Testing Library.
- Docker multi-stage para build y serving estático.
- GitHub Actions para CI y deploy a GitHub Pages.

## Reglas funcionales

- El modelo configurado es `TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC`, porque está soportado por la versión actual de WebLLM y evita depender de `shader-f16`.
- Las respuestas deben construirse con el prompt de sistema definido en `src/lib/chatbot.js` y con el contenido de `public/docs/negocio.txt`.
- El bot debe responder siempre en español, con frases cortas y naturales.
- La personalidad debe ser amigable, amistosa, formal y respetuosa.
- Si la respuesta no está en la información del negocio, debe responder amablemente que no tiene esa información por el momento y ofrecer ayuda con otra consulta.
- La app solo inicializa correctamente en contexto seguro: `https://` o `http://localhost`.

## Comandos locales

- Versiones de Node recomendadas: 20 LTS o 22 LTS. En Node 23 puede haber advertencias de engine aunque el proyecto funcione.
- Instalar dependencias: `npm ci`
- Desarrollo local: `npm run dev`
- Ejecutar tests una vez: `npm test -- --run`
- Ejecutar tests en watch: `npm run test:watch`
- Build de producción: `npm run build`
- Preview local del build: `npm run preview`
- Imagen Docker: `docker build -t pwa-local-chat .`

## Deploy

- GitHub Pages usa la workflow `.github/workflows/pages.yml`.
- El build de Pages se genera con `VITE_BASE_PATH=/${repo}/` para resolver correctamente rutas estáticas en el subpath del repositorio.
- La workflow de CI corre tests, build y build de Docker.

## Testing

- `src/lib/chatbot.test.js`: prompt, carga del documento y wrapper de WebLLM.
- `src/lib/capabilities.test.js`: validaciones de entorno seguro y WebGPU.
- `src/App.test.jsx`: render principal, inicialización y flujo de pregunta/respuesta.

## Mantenimiento

- Mantener la UI simple y claramente orientada a chat.
- No volver a cargar WebLLM desde CDN; debe seguir como dependencia local para producción.
- Si se cambia el modelo, verificar que el `model_id` exista en la `prebuiltAppConfig` de la versión instalada de WebLLM.
- Si se amplía la funcionalidad, agregar tests de lógica y de interfaz en la misma modificación.