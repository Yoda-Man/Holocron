## ADDED Requirements

### Requirement: Documented counts
A unit test SHALL fail when a count stated in `README.md` or `USER_MANUAL.md` differs from the repository. The counts are unit, integration, privacy and total tests, the WASM suite size, SIMD intrinsic calls, voice command patterns, audit actions and manual lines.

#### Scenario: Stale README count
- **WHEN** the README states a unit test count the suite does not have
- **THEN** the count guard fails naming the label and both numbers
