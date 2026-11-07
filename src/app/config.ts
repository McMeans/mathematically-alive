// Simulation settings shared by the build-time computation and the what-if worker.

/** Conferences the app has tiebreakers and paths for. A team's page uses its own conference. */
export const SUPPORTED_CONFERENCES: readonly string[] = ["ACC", "Big 12", "SEC", "Big Ten", "Mid-American", "Conference USA", "Mountain West", "American Athletic"];
export const SEED = 2026;
export const ITERATIONS = 20000;
