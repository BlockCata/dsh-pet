function createBlockedBrowserSearch() {
  return {
    async search() { return { status: 'blocked', sources: [], reason: 'network-isolation-unverified' }; },
    cancel() {},
    dispose() {},
  };
}

module.exports = { createBlockedBrowserSearch };
