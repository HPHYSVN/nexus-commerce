import * as jwt from 'jsonwebtoken';
import { verifyToken } from './jwt.util';

const SECRET = 'test-secret-at-least-32-chars-long!!';

describe('verifyToken', () => {
  it('accepts a valid HS256 token', () => {
    const t = jwt.sign({ email: 'a@b.c', role: 'CUSTOMER' }, SECRET, { subject: 'user-1', expiresIn: '15m', algorithm: 'HS256' });
    const claims = verifyToken(t, SECRET);
    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('CUSTOMER');
  });
  it('rejects expired and wrong-secret tokens', () => {
    const expired = jwt.sign({}, SECRET, { subject: 'u', expiresIn: '-1s', algorithm: 'HS256' });
    expect(() => verifyToken(expired, SECRET)).toThrow();
    const t = jwt.sign({}, SECRET, { subject: 'u', expiresIn: '1m', algorithm: 'HS256' });
    expect(() => verifyToken(t, 'other-secret')).toThrow();
  });
});
