# Use a Google public-HTML reader for the first web-query version

The first locally enabled, non-released web-query version will use the existing Google public-HTML reader rather than a paid search API or a user-operated backend. Google is the search entrypoint; the reader may retrieve at most three distinct, eligible candidate pages in result order. It reads only public content and does not use login state, cookies, CAPTCHA solving, consent automation, or access-control bypasses. Retrieved material is untrusted context and cannot request actions, diary work, settings changes, attachments, or other IPC mutations. A failure to obtain usable public material ends the external answer rather than falling back to unverified freshness. Successful answers expose source cards from main-process metadata, not model-generated citation numbers.

## Considered Options

- A paid search API was rejected for the first version because it adds provider, cost, and API-key governance.
- A user-operated backend was rejected because it expands the product into a deployed service.
