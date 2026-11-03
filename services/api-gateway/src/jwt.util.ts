import * as jwt from 'jsonwebtoken';

export interface JwtClaims { sub: string; email?: string; role?: string }

export function verifyToken(token: string, secret: string): JwtClaims {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Invalid token claims');
  return decoded as JwtClaims;
}
