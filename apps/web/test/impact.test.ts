// Formatting for the public /impact page.
import { IMPACT_FUNNEL_STEPS } from '@crewarcade/shared';
import { describe, expect, it } from 'vitest';
import { barWidth, dayLabel, duration, FUNNEL_TEXT, istTime, percent, referrerLabel, usdWithRupees } from '@/lib/impact';

describe('impact formatting', () => {
  it('durations read as seconds, then minutes', () => {
    expect(duration(null)).toBe('–');
    expect(duration(400)).toBe('1 s');
    expect(duration(71_000)).toBe('71 s');
    expect(duration(150_000)).toBe('2.5 min');
    expect(duration(180_000)).toBe('3 min');
  });

  it('percent and bar width never divide by zero; any non-zero value stays visible', () => {
    expect(percent(1, 0)).toBe(0);
    expect(percent(2, 3)).toBe(67);
    expect(barWidth(0, 10)).toBe('0%');
    expect(barWidth(1, 0)).toBe('0%');
    expect(barWidth(1, 100)).toBe('4%');
    expect(barWidth(10, 10)).toBe('100%');
  });

  it('days and times are shown in India Standard Time', () => {
    expect(dayLabel('2026-11-21')).toBe('Sat 21 Nov');
    expect(istTime('2026-11-21T13:12:00Z')).toBe('21 Nov, 6:42 pm IST');
  });

  it('referrer codes get readable names; unknown codes stay as typed', () => {
    expect(referrerLabel('college')).toBe('College groups');
    expect(referrerLabel('direct')).toBe('Direct visits');
    expect(referrerLabel('other')).toBe('Other links');
    expect(referrerLabel('hostel')).toBe('hostel');
  });

  it('AI cost shows dollars with an approximate rupee figure', () => {
    expect(usdWithRupees(null)).toBe('–');
    expect(usdWithRupees(0.02)).toBe('$0.02 (about ₹1.8)');
    expect(usdWithRupees(0.25)).toBe('$0.25 (about ₹22)');
  });

  it('every funnel step has page text', () => {
    for (const step of IMPACT_FUNNEL_STEPS) expect(FUNNEL_TEXT[step].label).toBeTruthy();
  });
});
