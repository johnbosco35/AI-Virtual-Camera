/** Server time is authoritative. Tests may override the clock; production never does. */
let nowFn: () => Date = () => new Date();
export const now = (): Date => nowFn();
export const setClock = (fn: () => Date) => {
  nowFn = fn;
};
export const resetClock = () => {
  nowFn = () => new Date();
};
