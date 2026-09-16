# Defer controlled network validation until release preparation

The web-query feature may be developed and locally enabled before the Docker or WSL controlled-network validation artifact is built. That validation remains a release gate: until it is complete, the project must not claim public-network isolation or release the feature, and production must not contain a runtime mechanism that permits validation-only private endpoints or test trust roots.
