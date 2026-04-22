class RateLimiterService {
  constructor({ maxPerMinute = 8 } = {}) {
    this.maxPerMinute = maxPerMinute;
    this.timestamps = [];
  }

  prune() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(
      (timestamp) => now - timestamp < 60000
    );
  }

  canProceed(count = 1) {
    this.prune();
    return this.timestamps.length + count <= this.maxPerMinute;
  }

  register(count = 1) {
    const now = Date.now();

    for (let i = 0; i < count; i += 1) {
      this.timestamps.push(now);
    }

    this.prune();
  }

  getStats() {
    this.prune();

    return {
      maxPerMinute: this.maxPerMinute,
      usedInCurrentWindow: this.timestamps.length,
      remainingInCurrentWindow: Math.max(
        0,
        this.maxPerMinute - this.timestamps.length
      )
    };
  }
}

module.exports = RateLimiterService;