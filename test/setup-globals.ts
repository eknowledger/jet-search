// Obsidian gives every window the globals `activeDocument` and `activeWindow`; the test document stands in.
Object.defineProperty(globalThis, "activeDocument", { configurable: true, get: () => document });
