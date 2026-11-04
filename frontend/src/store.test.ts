import { beforeEach, describe, expect, it } from 'vitest';
import { downloadCsv, money } from './api';
import { useGuestCart, useWishlist } from './store';

describe('money formatting', () => {
  it('formats USD with cents', () => {
    expect(money(79.9)).toBe('$79.90');
    expect(money(0)).toBe('$0.00');
  });
});

describe('guest cart store', () => {
  beforeEach(() => { useGuestCart.setState({ items: [] }); localStorage.clear(); });
  it('merges quantities for the same product and computes subtotal', () => {
    const item = { productId: 'p1', productName: 'Mug', unitPrice: 10, quantity: 1 };
    useGuestCart.getState().add(item);
    useGuestCart.getState().add({ ...item, quantity: 2 });
    expect(useGuestCart.getState().items).toHaveLength(1);
    expect(useGuestCart.getState().items[0].quantity).toBe(3);
    expect(useGuestCart.getState().subtotal()).toBe(30);
  });
  it('removes item when quantity set to 0', () => {
    useGuestCart.getState().add({ productId: 'p1', productName: 'Mug', unitPrice: 5, quantity: 1 });
    useGuestCart.getState().setQty('p1', 0);
    expect(useGuestCart.getState().items).toHaveLength(0);
  });
});

describe('wishlist store', () => {
  beforeEach(() => useWishlist.setState({ ids: [] }));
  it('toggles ids', () => {
    useWishlist.getState().toggle('a');
    expect(useWishlist.getState().has('a')).toBe(true);
    useWishlist.getState().toggle('a');
    expect(useWishlist.getState().has('a')).toBe(false);
  });
});

describe('downloadCsv escaping helper exists', () => {
  it('is a function', () => { expect(typeof downloadCsv).toBe('function'); });
});
