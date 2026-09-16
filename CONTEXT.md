# Big Fat Fish

Big Fat Fish is a Windows desktop-pet application. Its web-query capability gives an enabled pet bounded, read-only public-web context for a chat response.

## Language

**Web query**:
A chat turn in which a pet may obtain bounded public-web excerpts before answering.
_Avoid_: browsing, web tool

**Search decision**:
The model's constrained choice to answer directly or request one bounded web query.
_Avoid_: tool call, autonomous browsing

**Pinned reader**:
The application-owned read-only path used to retrieve public-web material for a web query.
_Avoid_: browser navigation, general HTTP client

**Blocked state**:
The state in which a web query returns no external material because the reader's safety evidence is not sufficient.
_Avoid_: degraded search, fallback mode

**Source metadata**:
The title, URL, retrieval time, coverage, and stable identifier that identify an external source without retaining its excerpt text.
_Avoid_: saved source content, cached page

**Candidate page**:
One of at most three public webpages selected from Google search results for a web query.
_Avoid_: arbitrary URL, browser tab

**External access policy**:
The rule that a web query reads only public content and never uses login state, cookies, CAPTCHA solving, consent automation, or access-control bypasses.
_Avoid_: browser-session reuse, authenticated browsing

**Search budget**:
The application-wide limits on search turns, candidate pages, excerpt text, and elapsed time for one web query.
_Avoid_: per-pet search limits, security policy setting

**Source card**:
The user-visible representation of source metadata attached to a web-query answer.
_Avoid_: model-generated citation, saved excerpt

**Budget snapshot**:
The immutable search budget captured when a web query begins.
_Avoid_: live budget, mid-query configuration

**Sensitive query**:
A search decision whose query matches the application's fixed secret, local-path, or common personal-identifier indicators and therefore requires explicit approval before it can leave the application.
_Avoid_: unsafe search, private search

**Diagnostic event**:
A local, de-identified record of a web query's request identifier, phase, fixed result code, duration, and source count.
_Avoid_: request transcript, web cache

**Search queue**:
The application-wide FIFO admission rule that permits one active web query and up to ten queued requests.
_Avoid_: per-pet concurrency, background queue
