---
paths:
  - "**/*.test.{ts,tsx}"
  - "**/*.spec.{ts,tsx}"
  - "tests/**"
  - "e2e/**"
---
# Testing rules

- Test title starts with the traceability ID: `it("HC-CH-012 strikes follow instrument list", ...)`.
- Unit (Vitest): pricing functions against published reference values; property tests for put-call parity and monotonic greeks.
- Integration: API handlers against a real Postgres (Testcontainers), never a mocked DB. Venue clients against recorded fixtures.
- E2E and visual (Playwright): both themes; diffs within the tolerance set in the spec.
- Never mock the pricing package. Never hit live exchange endpoints.
- "Tests pass" means you ran them in this session and quoted the tail of the output.
