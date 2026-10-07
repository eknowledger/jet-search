/** A worker's source, bundled by esbuild (esbuild.config.mjs, the inline-worker plugin) and inlined as text. */
declare module "worker:*" {
	const code: string;
	export default code;
}
