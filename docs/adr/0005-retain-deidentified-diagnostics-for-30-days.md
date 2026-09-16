# Retain de-identified web-query diagnostics for 30 days

Diagnostic events retain only a request identifier, phase, fixed result code, duration, and source count. The application retains at most 30 days or 1,000 events, whichever limit is reached first; queries, URLs, HTML, excerpts, headers, and keys are never diagnostic data.
