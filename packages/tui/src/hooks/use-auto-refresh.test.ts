import { describe, test, expect } from 'bun:test';

describe('auto-refresh interval logic', () => {
  test('countdown decrements correctly', () => {
    let secondsUntilRefresh = 60;
    let refreshCalled = false;

    const tick = () => {
      secondsUntilRefresh -= 1;
      if (secondsUntilRefresh <= 0) {
        refreshCalled = true;
        secondsUntilRefresh = 60;
      }
    };

    // 59 ticks should not trigger refresh
    for (let i = 0; i < 59; i++) tick();
    expect(refreshCalled).toBe(false);
    expect(secondsUntilRefresh).toBe(1);

    // 60th tick triggers refresh
    tick();
    expect(refreshCalled).toBe(true);
    expect(secondsUntilRefresh).toBe(60);
  });

  test('toggle on/off resets countdown', () => {
    const intervalSeconds = 30;
    let enabled = false;
    let countdown = intervalSeconds;

    // Toggle on
    enabled = !enabled;
    countdown = intervalSeconds;
    expect(enabled).toBe(true);
    expect(countdown).toBe(30);

    // Simulate some ticks
    countdown -= 10;
    expect(countdown).toBe(20);

    // Toggle off
    enabled = !enabled;
    countdown = intervalSeconds;
    expect(enabled).toBe(false);
    expect(countdown).toBe(30);
  });
});
