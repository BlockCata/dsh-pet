# Confirm sensitive queries in the main process

A sensitive query will be sent only after explicit user approval. Sensitive query indicators include likely secrets, local paths, and common personal or account identifiers. The main process retains and sends the original approved query; the renderer receives no query text and cannot substitute a different value. This preserves automatic web queries for ordinary requests while making the external transfer of likely private data an explicit decision.
