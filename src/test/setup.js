import "@testing-library/jest-dom/vitest";

if (!globalThis.HTMLElement.prototype.scrollIntoView) {
	globalThis.HTMLElement.prototype.scrollIntoView = () => {};
}