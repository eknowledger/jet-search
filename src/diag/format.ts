/** Small ways to write numbers in the support info. */

export const num = (n: number): string => n.toLocaleString("en-US");

export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** Milliseconds as a reader wants them: a decimal under 10, whole above. */
export const msText = (n: number): string => (n < 0.05 ? "0" : n < 10 ? n.toFixed(1) : String(Math.round(n)));
