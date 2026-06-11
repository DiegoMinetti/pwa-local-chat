import "@testing-library/jest-dom/vitest";

if (!globalThis.HTMLElement.prototype.scrollIntoView) {
	globalThis.HTMLElement.prototype.scrollIntoView = () => {};
}

// jsdom no siempre expone localStorage; App y los tests lo usan.
if (!globalThis.localStorage) {
	const store = new Map();
	const localStorageMock = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(String(key), String(value)),
		removeItem: (key) => store.delete(key),
		clear: () => store.clear(),
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	};
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: localStorageMock,
	});
}