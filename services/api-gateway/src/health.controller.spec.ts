import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok', () => {
    expect(new HealthController().health()).toEqual({ status: 'ok', service: 'api-gateway' });
  });
});
