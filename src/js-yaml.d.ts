// Minimal type surface for js-yaml 3.x (not declared in @types).
declare module 'js-yaml' {
	export function safeLoad(input: string): unknown;
	export function load(input: string): unknown;
	export function dump(input: unknown, options?: Record<string, unknown>): string;
}
