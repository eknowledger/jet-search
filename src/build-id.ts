// Replaced by esbuild per build; undefined when run without it (unit tests).
declare const __JET_BUILD_ID__: string | undefined;

/** Which build is loaded: set by esbuild per build, read to tell which build is running. */
export const BUILD_ID: string = typeof __JET_BUILD_ID__ === "string" ? __JET_BUILD_ID__ : "dev";
