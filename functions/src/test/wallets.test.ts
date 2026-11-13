import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchWallet, WalletLite } from '../sync';

const W = (id: string, name: string, provider = '', status = 'Active'): WalletLite => ({ id, name, provider, status });

test('matches the one active wallet for the provider (by provider or name)', () => {
  const wallets = [W('w1', 'Paytm', 'Paytm'), W('w2', 'Cash'), W('w3', 'Shopping balance', 'Amazon Pay')];
  assert.equal(matchWallet('Paytm', wallets), 'w1');
  assert.equal(matchWallet('Amazon Pay', wallets), 'w3');
  assert.equal(matchWallet('PhonePe', wallets), null);
});

test('ambiguous or closed matches are left for the reviewer', () => {
  assert.equal(matchWallet('Paytm', [W('a', 'Paytm'), W('b', 'Paytm work', 'Paytm')]), null);
  assert.equal(matchWallet('Paytm', [W('a', 'Paytm', 'Paytm', 'Closed')]), null);
  assert.equal(matchWallet(null, [W('a', 'Paytm')]), null);
});

test('Pluxee also matches an old "Sodexo" wallet', () => {
  assert.equal(matchWallet('Pluxee (Sodexo)', [W('m', 'Sodexo meal card')]), 'm');
});
