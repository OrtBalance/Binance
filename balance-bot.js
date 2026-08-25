const https = require('https');
const crypto = require('crypto');

// --- Configure your Binance API credentials here ---
const API_KEY = 'QQ9j5AjTX8yIs5eRYvO4JLgbjoViaHVGp8oQCqRLZVX0DpdmX1Ka9x2mS3z6q3Yu';
const API_SECRET = 'Yd8Ige9L42UEhNamcme71WPvKkhu1WF9elknsn4mE06dZ0iR0lBN6P0sNUsOA46c';

// false = mainnet (real Binance), true = testnet (testnet.binance.vision keys)
const USE_TESTNET = false;

// Check interval in ms (60000 = 1 minute). Set to 0 for a single check.
const CHECK_INTERVAL_MS = 0;

const API_HOST = USE_TESTNET ? 'testnet.binance.vision' : 'api.binance.com';

function sign(queryString) {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

function getAccount() {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}&recvWindow=5000`;
    const signature = sign(query);
    const path = `/api/v3/account?${query}&signature=${signature}`;

    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method: 'GET',
        headers: { 'X-MBX-APIKEY': API_KEY },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(json.msg || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

function formatBalance(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function printBalances(account) {
  const timestamp = new Date().toLocaleString();
  const nonZero = account.balances.filter(
    (b) => Number(b.free) > 0 || Number(b.locked) > 0
  );

  console.log('\n' + '='.repeat(60));
  console.log(`Binance Balance Check — ${timestamp}`);
  console.log('='.repeat(60));

  if (nonZero.length === 0) {
    console.log('No assets with balance found.');
    return;
  }

  console.log(
    `${'Asset'.padEnd(12)} ${'Free'.padStart(18)} ${'Locked'.padStart(18)} ${'Total'.padStart(18)}`
  );
  console.log('-'.repeat(60));

  for (const { asset, free, locked } of nonZero) {
    const total = Number(free) + Number(locked);
    console.log(
      `${asset.padEnd(12)} ${formatBalance(free).padStart(18)} ${formatBalance(locked).padStart(18)} ${formatBalance(total).padStart(18)}`
    );
  }

  console.log('-'.repeat(60));
  console.log(`Assets with balance: ${nonZero.length}`);
  console.log(`Can trade: ${account.canTrade ? 'Yes' : 'No'}`);
  console.log(`Can withdraw: ${account.canWithdraw ? 'Yes' : 'No'}`);
  console.log(`Can deposit: ${account.canDeposit ? 'Yes' : 'No'}`);
}

function getPublicIp() {
  return new Promise((resolve) => {
    https.get('https://api.ipify.org?format=json', (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).ip);
        } catch {
          resolve('unknown');
        }
      });
    }).on('error', () => resolve('unknown'));
  });
}

async function printInvalidKeyHelp() {
  const ip = await getPublicIp();
  console.error('\nFix checklist:');
  console.error(`  1. Network: using ${USE_TESTNET ? 'TESTNET' : 'MAINNET'} (${API_HOST})`);
  console.error('     Mainnet keys -> USE_TESTNET = false');
  console.error('     Testnet keys -> USE_TESTNET = true');
  console.error('  2. Permissions: enable "Enable Reading" on the API key');
  console.error(`  3. IP whitelist: if restricted, add this IP -> ${ip}`);
  console.error('  4. Key source: create keys at binance.com (mainnet) or testnet.binance.vision (testnet)');
  console.error('  5. Secret: re-copy the secret (shown only once when the key was created)');
}

async function checkBalance() {
  try {
    const account = await getAccount();
    printBalances(account);
  } catch (error) {
    console.error('\nBalance check failed:', error.message);

    if (error.message.includes('Invalid API-key')) {
      await printInvalidKeyHelp();
    } else if (error.message.includes('Signature')) {
      console.error('The API secret is wrong. Re-copy it from Binance API Management.');
    } else if (error.message.includes('IP')) {
      const ip = await getPublicIp();
      console.error(`Your IP (${ip}) is not whitelisted on this API key.`);
    }
  }
}

function main() {
  if (!API_KEY || !API_SECRET || API_KEY.includes('your_api_key') || API_SECRET.includes('your_api_secret')) {
    console.error('Set your BINANCE API_KEY and API_SECRET at the top of this file.');
    process.exit(1);
  }

  console.log('Binance Balance Bot started.');
  console.log(`Network: ${USE_TESTNET ? 'TESTNET' : 'MAINNET'} (${API_HOST})`);
  console.log(`Mode: ${CHECK_INTERVAL_MS <= 0 ? 'single check' : `every ${CHECK_INTERVAL_MS / 1000}s`}`);

  checkBalance();

  if (CHECK_INTERVAL_MS > 0) {
    setInterval(checkBalance, CHECK_INTERVAL_MS);
  }
}

main();
