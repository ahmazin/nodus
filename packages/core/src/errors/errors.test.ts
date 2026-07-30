import { describe, expect, it } from 'vitest';
import { NodusError, isNodusError } from './index.js';

describe('NodusError', () => {
  it('carries code, brand, name, message, and optional context/cause', () => {
    const cause = new Error('root');
    const e = new NodusError('unknown-node-type', 'boom', { context: { type: 'ghost' }, cause });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NodusError');
    expect(e.code).toBe('unknown-node-type');
    expect(e.brand).toBe('@ahmazin/core:NodusError');
    expect(e.message).toBe('boom');
    expect(e.context).toEqual({ type: 'ghost' });
    expect(e.cause).toBe(cause);
  });

  it('omits context entirely when not supplied', () => {
    const e = new NodusError('invalid-util', 'x');
    expect(e.context).toBeUndefined();
    expect('context' in e).toBe(false); // not an own key set to undefined
  });
});

describe('isNodusError (dual-package-safe brand check)', () => {
  it('matches a NodusError from this build', () => {
    expect(isNodusError(new NodusError('invalid-util', 'x'))).toBe(true);
  });

  it('matches a FOREIGN error with the same brand+code shape (the dual-package seam)', () => {
    // A NodusError minted by a SECOND copy of @ahmazin/core (an ESM build and a CJS build coexisting
    // in one process) is a *different class*, so `instanceof` would reject it. The brand string is
    // what must identify it across the seam — this is the whole reason isNodusError exists.
    const foreign = { brand: '@ahmazin/core:NodusError', code: 'unknown-layout', message: 'from the other copy' };
    expect(isNodusError(foreign)).toBe(true);
    expect(foreign instanceof NodusError).toBe(false); // exactly the case a naive instanceof misses
  });

  it('rejects a plain Error and non-branded / non-object values', () => {
    expect(isNodusError(new Error('plain'))).toBe(false);
    expect(isNodusError({ code: 'unknown-layout' })).toBe(false); // branded discriminant missing
    expect(isNodusError({ brand: '@ahmazin/core:NodusError' })).toBe(false); // no string `code`
    expect(isNodusError({ brand: 'something-else', code: 'x' })).toBe(false); // wrong brand
    expect(isNodusError(null)).toBe(false);
    expect(isNodusError('unknown-layout')).toBe(false);
  });
});
