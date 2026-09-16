/** Milisaniye cinsinden şimdiki zaman. Testlerde sabitlenebilsin diye enjekte edilir. */
export type MsClock = () => number;

export const CLOCK_MS = Symbol('CLOCK_MS');

export const systemClockMs: MsClock = () => Date.now();
