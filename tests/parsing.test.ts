import { describe, it, expect } from 'vitest';

/**
 * Tests for the parameter parsing pattern used in items.routes.ts.
 * Verifies that the fix for falsy zero coercion works correctly.
 */

// Replicate the parsing logic from items.routes.ts (create item)
function parsePrice(price: any): number | undefined {
  return price != null && price !== '' ? parseFloat(price) : undefined;
}

function parseQuantity(quantity: any): number | undefined {
  return quantity != null && quantity !== '' ? parseInt(quantity, 10) : undefined;
}

function parseIsVisible(isVisible: any): number {
  return isVisible != null && isVisible !== '' ? parseInt(isVisible, 10) : 1;
}

// Replicate update logic (with outer guard already applied)
function parseUpdatePrice(price: any): number | undefined {
  return price !== '' ? parseFloat(price) : undefined;
}

function parseUpdateQuantity(quantity: any): number | undefined {
  return quantity !== '' ? parseInt(quantity, 10) : undefined;
}

describe('parsePrice', () => {
  it('parses string "0" as 0', () => {
    expect(parsePrice('0')).toBe(0);
  });

  it('parses number 0 as 0', () => {
    expect(parsePrice(0)).toBe(0);
  });

  it('parses normal price', () => {
    expect(parsePrice('49.99')).toBe(49.99);
  });

  it('returns undefined for empty string', () => {
    expect(parsePrice('')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(parsePrice(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parsePrice(undefined)).toBeUndefined();
  });
});

describe('parseQuantity', () => {
  it('parses string "0" as 0', () => {
    expect(parseQuantity('0')).toBe(0);
  });

  it('parses number 0 as 0', () => {
    expect(parseQuantity(0)).toBe(0);
  });

  it('parses normal quantity', () => {
    expect(parseQuantity('5')).toBe(5);
  });

  it('returns undefined for empty string', () => {
    expect(parseQuantity('')).toBeUndefined();
  });
});

describe('parseIsVisible', () => {
  it('parses string "0" as 0 (hidden)', () => {
    expect(parseIsVisible('0')).toBe(0);
  });

  it('parses number 0 as 0 (hidden)', () => {
    expect(parseIsVisible(0)).toBe(0);
  });

  it('parses string "1" as 1 (visible)', () => {
    expect(parseIsVisible('1')).toBe(1);
  });

  it('defaults to 1 when undefined', () => {
    expect(parseIsVisible(undefined)).toBe(1);
  });

  it('defaults to 1 when empty string', () => {
    expect(parseIsVisible('')).toBe(1);
  });
});

describe('parseUpdatePrice (with outer guard)', () => {
  it('parses "0" as 0', () => {
    expect(parseUpdatePrice('0')).toBe(0);
  });

  it('parses 0 as 0', () => {
    expect(parseUpdatePrice(0)).toBe(0);
  });

  it('returns undefined for empty string', () => {
    expect(parseUpdatePrice('')).toBeUndefined();
  });
});

describe('parseUpdateQuantity (with outer guard)', () => {
  it('parses "0" as 0', () => {
    expect(parseUpdateQuantity('0')).toBe(0);
  });

  it('parses 0 as 0', () => {
    expect(parseUpdateQuantity(0)).toBe(0);
  });

  it('returns undefined for empty string', () => {
    expect(parseUpdateQuantity('')).toBeUndefined();
  });
});
