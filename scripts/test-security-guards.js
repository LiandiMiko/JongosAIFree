const dns = require('dns');
const { classifyIntent } = require('../src/agent/decision');
const fetchSkill = require('../skills/fetch');

const cases = [
  ['bitcoin itu apa', 'general'],
  ['btc itu apa', 'general'],
  ['btc?', 'general'],
  ['harga btc sekarang', 'realtime'],
  ['berapa harga bitcoin', 'realtime'],
];

let failed = 0;
for (const [text, expected] of cases) {
  const actual = classifyIntent(text).type;
  if (actual === expected) {
    console.log(`✓ intent "${text}" → ${actual}`);
  } else {
    console.error(`✗ intent "${text}" → ${actual} (expected ${expected})`);
    failed++;
  }
}

const privateAddresses = [
  '127.0.0.1',
  '10.0.0.5',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.10.2',
  '::1',
  '::',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '::ffff:0a00:0005',
];
const publicAddresses = ['8.8.8.8', '2606:4700:4700::1111'];

for (const address of privateAddresses) {
  if (fetchSkill.isPrivateAddress(address)) {
    console.log(`✓ blocks private address ${address}`);
  } else {
    console.error(`✗ allowed private address ${address}`);
    failed++;
  }
}

for (const address of publicAddresses) {
  if (!fetchSkill.isPrivateAddress(address)) {
    console.log(`✓ allows public address ${address}`);
  } else {
    console.error(`✗ blocks public address ${address}`);
    failed++;
  }
}

for (const host of ['localhost', 'service.localhost', 'gateway.local', 'router.internal', '[::1]']) {
  if (fetchSkill.isPrivateHost(host)) {
    console.log(`✓ blocks local hostname ${host}`);
  } else {
    console.error(`✗ allowed local hostname ${host}`);
    failed++;
  }
}

async function testDnsResolutionGuard() {
  const originalLookup = dns.lookup;
  try {
    dns.lookup = (_host, _options, callback) => callback(null, [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const blocked = await new Promise((resolve) => {
      fetchSkill.safeLookup('127.0.0.1.nip.io', {}, (error) => resolve(Boolean(error)));
    });
    if (blocked) {
      console.log('✓ blocks DNS names resolving to a private address');
    } else {
      console.error('✗ allowed a DNS name resolving to a private address');
      failed++;
    }
  } finally {
    dns.lookup = originalLookup;
  }
}

testDnsResolutionGuard().then(() => {
  if (failed) process.exitCode = 1;
  else console.log('\nAll security guard tests passed.');
}).catch((error) => {
  console.error('Security guard test failed:', error.message);
  process.exitCode = 1;
});
