/**
 * Time budgets in tests are set for a developer's machine. A shared CI runner is several times slower, so
 * the same work takes longer there without anything having got worse. Scale a budget with `budget(ms)`.
 */
export const budget = (ms: number): number => (process.env.CI ? ms * 4 : ms);
