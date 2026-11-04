# Compatibility

The machine-readable source of truth is `compatibility-matrix.json`. The website must read **only `PASS` rows** when listing supported platforms.

Current status: every platform is `NOT_TESTED`, because the native virtual camera has not been built yet. Nothing may be advertised as supported.

Rules (enforced by `apps/api/src/tests/compatMatrix.test.ts`):

- `PASS` requires application version, Windows build, virtual camera version, test date, and all six checks true (listed, selectable, live preview, correct animation, stable for 15 minutes, safe camera switching), plus reproducible steps.
- A platform that detects the camera but shows no output is `PARTIAL` or `FAIL`, never `PASS`.
- `PARTIAL` and `FAIL` need a dated explanation.
- Results apply to the exact application version and Windows build recorded. Retest per version, especially WhatsApp and WeChat.

See `TEST_PROCEDURES.md` for how to run each test.
