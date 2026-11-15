import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { _setCarresApiSecretForTesting } from "../lib/api-door";
import { TEST_API_DOOR_SECRET } from "./api-door";
import { server } from "./server";

// MSW (Mock Service Worker) intercepts outbound fetch in Node so route tests
// don't hit real Supabase. Per-test handlers can be added via server.use(...).
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The API door (lib/api-door.ts) reads one value from the database the first time a store calls a route that
// needs it. Every test starts with that value already held, so a route test is about its route. The door's own
// tests forget it on purpose.
beforeEach(() => _setCarresApiSecretForTesting(TEST_API_DOOR_SECRET));
